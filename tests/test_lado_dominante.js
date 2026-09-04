// =============================================================================
// LADO DOMINANTE — test headless (Node)
// =============================================================================
// El lado dominante es el que corre A LO LARGO de la pieza: el que el 'auto'
// estira contra el hormigón y el que recibe el empalme. El usuario pidió dos
// cosas: VERLO en el preview (tramo destacado) y CONTROLARLO desde la ficha.
//
// QUÉ PROTEGE, en orden:
//   A. CASCADA — ladoDominanteFigura devuelve lo esperado para las figuras del
//      guion (101A/102A/103B/104B/106A) y no depende de las dims del momento.
//   B. MAPEO TRAMO ↔ TRAZO (_tramoDominanteEnTrazo) — el rango de puntos que el
//      preview destaca es REALMENTE el lado dominante, medido contra las dims
//      resueltas de la barra que dibujó el motor. Incluye los dos casos que
//      rompen la cuenta ingenua "el tramo i son los puntos i,i+1":
//        · un gancho >90° se dibuja como arco muestreado (15 puntos por vértice);
//        · dos ganchos seguidos dejan sus arcos PEGADOS en la lista y entre medio
//          está justo el cuerpo (103E: puntos 1..15 y 16..30, cuerpo 15→16).
//   C. NO DESTACAR ANTES QUE DESTACAR MAL — las familias con constructor propio
//      (marco de estribo, rombo, traba) devuelven null: ahí el trazo no es la
//      cadena de tramos de la figura (un 103E con rol estribo dibuja 4 lados
//      teniendo 3 parciales) y no hay mapeo que derivar.
//   D. comp.lado_dominante YA LO LEE EL MOTOR (tanda Δ, 14-ago) — y la C de un
//      103A SIGUE sin cambiar nada, ahora por una razón FÍSICA en vez de por un
//      cable que faltaba: en una 103A los tramos son A(gancho) → B(cuerpo) →
//      C(gancho), o sea C es un tramo TERMINAL. Un gancho no puede ser el lado
//      que se ancla contra el hormigón y se estira con el 'auto' — es la pata que
//      cuelga —, así que el motor lo IGNORA, cae a la cascada (B) y lo AVISA. Los
//      números de este bloque son los mismos de antes; lo que cambió es que ahora
//      hay un aviso que lo explica, y eso también se fija acá.
//      La elección que SÍ manda (un lado interior no diagonal) y el resto del
//      contrato viven en tests/test_delta_dominante.js, bloques F y G.
//
// Correr con: node tests/test_lado_dominante.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// --------------------------------------------------------------- entorno mínimo
// template_editor.js sólo necesita `global` para publicarse y para leer los otros
// módulos: acá se prueban funciones PURAS (mapeo de índices, lectura del campo),
// así que el DOM es un stub que nadie toca.
function El() {
  this.style = {}; this.dataset = {}; this.children = []; this.className = ''; this.value = '';
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.setAttribute = function () {}; El.prototype.getAttribute = function () { return null; };
El.prototype.addEventListener = function () {}; El.prototype.removeEventListener = function () {};
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };

const win = {};
win.window = win; win.self = win;
win.document = {
  body: new El(), documentElement: new El(), head: new El(),
  createElement: () => new El(), createElementNS: () => new El(), createTextNode: () => new El(),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}
};
win.console = console;
win.JSON = JSON; win.Math = Math; win.Date = Date; win.Object = Object; win.Array = Array;
win.Number = Number; win.String = String; win.Boolean = Boolean; win.isFinite = isFinite;
win.parseFloat = parseFloat; win.parseInt = parseInt; win.isNaN = isNaN; win.Error = Error;
win.Promise = Promise; win.RegExp = RegExp;
win.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
win.navigator = { userAgent: 'node' };
win.location = { href: 'http://x/', origin: 'http://x' };
win.fetch = () => Promise.reject(new Error('sin red'));
win.alert = () => {}; win.confirm = () => false;
win.setTimeout = () => 0; win.clearTimeout = () => {};
win.setInterval = () => 0; win.clearInterval = () => {};
win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
win.addEventListener = () => {}; win.removeEventListener = () => {};
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
mod('motor_geom.js', 'ModeladorMotorGeom');
mod('reglas.js', 'ModeladorReglas');
mod('generar.js', 'ModeladorGenerar');
mod('semilla_viga.js', 'ModeladorSemilla');
vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });

const FP = win.ModeladorFiguraPuntos;
const CAT = win.ModeladorCatalogoFiguras;
const R = win.ModeladorReglas;
const TE = win.TemplateEditor;

const HOST = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

function dimsAuto(fig) {
  const sp = CAT.get(fig) || {};
  const d = {};
  (sp.parciales || []).forEach(p => { d[p] = { modo: 'auto' }; });
  return d;
}
function comp(fig, tip, extra) {
  const c = {
    comp_id: 'X', jerarquia: 2, tipologia: tip, figura: fig, diam: 16, suf_tipo: '',
    cara: (tip === 'ES' || tip === 'TRV') ? 'lateral' : 'sup',
    recub_override: null, angulos: [], prioridad: null, empalme: null, depende_de: null,
    modo: 'puntual', plano_pieza: { volteado: false },
    arreglo: { n_capas: 1, sep_capas: 20, rango: null },
    dims: dimsAuto(fig),
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}
function primerPlacement(c) {
  const pls = R.expandirComponente(c, HOST);
  return (pls && pls.length) ? { pl: pls[0], rol: c._rol } : null;
}
function largo(p, q) {
  return Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);
}
// Largo del trecho [i0,i1] de la polilínea (la suma de sus segmentos).
function largoTramo(pts, i0, i1) {
  let L = 0;
  for (let i = i0; i < i1; i++) L += largo(pts[i], pts[i + 1]);
  return L;
}

// ============================================================ A · CASCADA
console.log('A — cascada determinista (spec.lado_dominante → B → primer parcial)');
{
  [['101A', 'A'], ['102A', 'B'], ['102B', 'B'], ['103A', 'B'], ['103B', 'B'],
   ['104B', 'B'], ['104D', 'B'], ['106A', 'B']].forEach(([fig, esp]) => {
    ok(FP.ladoDominanteFigura(fig) === esp,
      fig + ' → ' + esp + ' (dio ' + FP.ladoDominanteFigura(fig) + ')');
  });
  // Es propiedad de la FIGURA, no de sus medidas: con la pata A gigante sigue
  // siendo B (antes ganaba "el más largo medido" y editar una pata movía en
  // silencio la dim que se estira y la que se empalma).
  ok(R.ladoDominante({ figura: '103A', dims: { A: 500, B: 20, C: 10 } }) === 'B',
    '103A con A=500 y B=20 sigue dando B (no gana el más largo medido)');
}

// ============================================ B · MAPEO TRAMO ↔ TRAZO (preview)
console.log('\nB — el tramo que el preview destaca ES el lado dominante');
{
  // [figura, tipología, tolerancia en cm]. La tolerancia cubre el RETRANQUEO del
  // gancho con radio: el cuerpo entra tangente al arco, o sea pierde R = 2.5·φ por
  // cada extremo que remate en gancho de más de 90° de RECORRIDO (φ16 → 4 cm por
  // gancho).
  //
  // 18-AGO · LAS TOLERANCIAS SE INTERCAMBIAN (convención de VÉRTICE, cerrada por el
  // usuario). El número del catálogo pasa a leerse como ángulo del VÉRTICE, así que
  // QUIÉN lleva gancho arqueado se da vuelta:
  //   · las de ficha 45 (103B, 104B) son ahora vértices CERRADOS = 135° de recorrido
  //     → SÍ llevan codo. La 103B lo lleva en sus dos puntas (8.0 medidos) y la 104B
  //     en una sola (el otro codo cae sobre la C, 4.0 medidos);
  //   · las de ficha 135 (102B, 103E) son ahora vértices ABIERTOS = 45° de recorrido
  //     → NO llevan codo y su cuerpo mide exacto.
  // Es el mismo assert con los papeles cambiados: ninguna figura sale de la lista.
  [['101A', 'CBS', 0.1], ['102A', 'CBS', 0.1], ['103A', 'CBS', 0.1],
   ['102B', 'CBS', 0.1], ['103E', 'CBS', 0.1],
   ['104B', 'CBS', 4.5], ['103B', 'CBS', 8.5]].forEach(([fig, tip, tol]) => {
    const c = comp(fig, tip);
    const r = primerPlacement(c);
    if (!r) { ok(false, fig + ' ' + tip + ': el motor no devolvió placements'); return; }
    const dom = FP.ladoDominanteFigura(fig);
    const rng = TE._tramoDominanteEnTrazo(fig, r.rol, r.pl.puntos, r.pl.diam, dom);
    if (!rng) { ok(false, fig + ' ' + tip + ': no se derivó el tramo dominante'); return; }
    const medido = largoTramo(r.pl.puntos, rng.i0, rng.i1);
    // 20-AGO · MEDIDA HASTA LA CRESTA. La dim ya no es la cadena de vértices: suma
    // R + φ por cada doblez que cierra el lado, así que el TRAZO mide la dim menos
    // ese sobre (y menos el retranqueo del codo arqueado, que es lo que siguen
    // cubriendo las tolerancias de arriba, intactas).
    const sc = FP.sobresCresta(fig, r.rol, r.pl.diam, null);
    const esperado = Number(r.pl.dims[dom]) - (Number(sc[dom]) || 0);
    ok(Math.abs(medido - esperado) <= tol,
      fig + ' ' + tip + ': destaca el lado ' + dom + ' (' + medido.toFixed(1) +
      ' cm vs dim ' + esperado.toFixed(1) + ', tol ' + tol + ')');
    // …y es el trecho MÁS LARGO del trazo en estas figuras (el cuerpo), o sea no
    // se está destacando una pata por casualidad de índices.
    let peor = 0;
    for (let i = 0; i + 1 < r.pl.puntos.length; i++) {
      if (i >= rng.i0 && i < rng.i1) continue;
      peor = Math.max(peor, largo(r.pl.puntos[i], r.pl.puntos[i + 1]));
    }
    ok(medido > peor, fig + ' ' + tip + ': el tramo destacado es el cuerpo, no una pata');
  });

  // 101A es una RECTA: su único lado es el dominante y el resaltado es la barra
  // entera (0 → último punto).
  {
    const r = primerPlacement(comp('101A', 'CBS'));
    const rng = TE._tramoDominanteEnTrazo('101A', r.rol, r.pl.puntos, r.pl.diam, 'A');
    ok(rng && rng.i0 === 0 && rng.i1 === r.pl.puntos.length - 1,
      '101A (recta): el lado dominante es la barra entera');
  }

  // DOS GANCHOS SEGUIDOS: dos grupos de arco PEGADOS en la lista con el cuerpo justo
  // entre ellos. Es el caso que rompe "un run de esArco = un vértice".
  // 18-AGO: la figura que lo representa pasa de la 103E a la 103B. Con la convención
  // de VÉRTICE el codo arqueado lo llevan las de ficha 45 (vértice cerrado = 135° de
  // recorrido), no las de ficha 135. La 103B declara 45/45, o sea gancho en las dos
  // puntas: exactamente la topología que este assert quiere.
  {
    const r = primerPlacement(comp('103B', 'CBS'));
    const rng = TE._tramoDominanteEnTrazo('103B', r.rol, r.pl.puntos, r.pl.diam, 'B');
    ok(rng && r.pl.puntos[rng.i0].esArco && r.pl.puntos[rng.i1].esArco,
      '103B: el cuerpo va DE un punto de arco A otro (los dos grupos están pegados)');
    ok(rng && (rng.i1 - rng.i0) === 1, '103B: el cuerpo es un solo segmento recto');
  }
}

// ================================== C · familias sin mapeo → no se destaca nada
console.log('\nC — sin mapeo fiable no se destaca nada (mejor eso que el lado equivocado)');
{
  // (14-ago) La 101A-TRV salió de esta lista: la forma fija murió y su trazo
  // real SÍ es su cadena (una recta = su parcial A), así que el dominante mapea.
  // 22-AGO · LA 103E SALIÓ DE ESTA LISTA, y por la misma razón por la que entró la
  // 101A-TRV el 14-ago: su trazo SÍ es su cadena. Estaba acá porque la rama
  // `rol === 'estribo'` de familiaDeDibujo la mandaba al constructor de marco —
  // «dibuja 4 lados teniendo 3 parciales»—, que es exactamente el defecto que se
  // corrigió: 17 figuras del catálogo (101A · 102A/B/C · 103A–L · 201A) salían con el
  // MISMO perímetro de 170.214 cm bajo ES/EC/ESC, o sea la figura elegida no existía.
  // Con la figura mandando el trazado, la 103E se dibuja como su cadena de 3 tramos y
  // el dominante SÍ mapea: no destacarlo sería esconder el lado que el auto estira.
  // Lo que queda en la lista es lo que de verdad no tiene mapeo: el MARCO CERRADO
  // (104D dibuja 4 lados del marco de núcleo, no de sus dims) y el 106A.
  [['104D', 'ES', 'marco de estribo: dibuja 4 lados'],
   ['106A', 'ES', 'rombo: constructor propio']
  ].forEach(([fig, tip, porque]) => {
    const c = comp(fig, tip);
    c.diam = 8;
    const r = primerPlacement(c);
    if (!r) { ok(false, fig + ' ' + tip + ': el motor no devolvió placements'); return; }
    const rng = TE._tramoDominanteEnTrazo(fig, r.rol, r.pl.puntos, r.pl.diam,
      FP.ladoDominanteFigura(fig));
    ok(rng === null, fig + ' ' + tip + ' → null (' + porque + ')');
  });
  // …Y LA OTRA MITAD, que es la que este test perdió al sacar la 103E de arriba: una
  // figura ABIERTA colocada como pieza de sección SÍ tiene mapeo, porque su trazo es
  // su cadena. Si mañana volviera a caer en el constructor de marco, esto lo caza.
  {
    const c = comp('103E', 'ES');
    c.diam = 8;
    const r = primerPlacement(c);
    const rng = r && TE._tramoDominanteEnTrazo('103E', r.rol, r.pl.puntos, r.pl.diam,
      FP.ladoDominanteFigura('103E'));
    ok(!!rng, '103E ES → SÍ se destaca su dominante: se dibuja como su cadena de 3 tramos (=' +
      JSON.stringify(rng) + ')');
  }
  // Sin φ no hay cota para separar arco de tramo real: tampoco se adivina.
  {
    const r = primerPlacement(comp('102B', 'CBS'));
    ok(TE._tramoDominanteEnTrazo('102B', r.rol, r.pl.puntos, 0, 'B') === null,
      'φ = 0 → null (sin diámetro no hay cota de cuerda de arco)');
    ok(TE._tramoDominanteEnTrazo('102B', r.rol, r.pl.puntos, r.pl.diam, 'Z') === null,
      'lado inexistente → null');
  }
}

// ================== D · el motor lee comp.lado_dominante, y un GANCHO lo rechaza
console.log('\nD — comp.lado_dominante lo lee el motor, y un lado TERMINAL sí puede serlo');
{
  // ESTE BLOQUE CAMBIÓ DE SIGNO EL 3-sep, a pedido del usuario y con medida.
  // Antes decía: «la C de una 103A es un gancho» y exigía que el motor la ignorara.
  // La premisa era «tramo terminal ⇒ gancho», y NO se sostiene: cuál lado es el
  // cuerpo depende de CÓMO SE USA la figura. El caso que lo rompió es la 103C de
  // una malla vertical naciente — fierro recto que sube, pata cruzando el espesor,
  // gancho: los dos quiebres viven en la misma punta, así que el cuerpo es TERMINAL.
  // Con la regla vieja no había forma de decirlo y la barra salía con un quiebre en
  // cada extremo, el de arriba montado sobre el empalme, 66 cm fuera del hormigón.
  // Lo que NO cambió, y por eso sigue medido acá abajo: la cascada por DEFECTO
  // (ninguna receta existente se mueve), los ganchos DECLARADOS de un contorno
  // cerrado, y los lados diagonales.
  const base = comp('103A', 'CBS');
  const conElec = comp('103A', 'CBS', { lado_dominante: 'C' });
  ok(R.ladoDominante(base) === 'B', 'sin elección el motor resuelve B (la cascada no cambia)');
  ok(R.ladoDominante(conElec) === 'C',
    'con lado_dominante:"C" el motor obedece: quien coloca la barra sabe cuál lado corre');
  ok(FP.validarLadoDominante('103A', 'C').ok,
    'y la validación lo acepta en una cadena ABIERTA');
  const a = primerPlacement(base), b = primerPlacement(conElec);
  ok(JSON.stringify(a.pl.dims) !== JSON.stringify(b.pl.dims),
    'las dims resueltas CAMBIAN: el auto estira el lado elegido');
  ok(JSON.stringify(a.pl.puntos) !== JSON.stringify(b.pl.puntos),
    'y el dibujo lo refleja (una elección obedecida mueve la barra)');
  ok(!(conElec._avisos || []).some(a2 => a2.indexOf('Lado dominante C ignorado') === 0),
    'ya no hay aviso de ignorado: no se ignoró');
  ok(!FP.validarLadoDominante('106A', 'A').ok,
    'pero el GANCHO DECLARADO de un contorno cerrado (106A) se sigue rechazando');
  ok(!FP.validarLadoDominante('103C', 'A').ok,
    'y un lado DIAGONAL también (la A de una 103C sale del plano de trabajo)');
  ok(FP.validarLadoDominante('103C', 'C').ok,
    'la C de la 103C sí: es perpendicular a la pata, y es el fierro que sube');
  // Acá se fija además que el helper de la UI lee y escribe el campo, y que
  // 'auto' lo borra.
  const c = comp('103A', 'CBS');
  ok(TE._ladoDomElegido(c) === null, 'sin campo → sin elección');
  TE._setLadoDominante(c, 'c');
  ok(c.lado_dominante === 'C' && TE._ladoDomElegido(c) === 'C', 'escribe en mayúscula');
  TE._setLadoDominante(c, 'Z');
  ok(c.lado_dominante === 'C', 'un lado que la figura no tiene NO se escribe');
  TE._setLadoDominante(c, null);
  ok(!('lado_dominante' in c), 'auto borra el campo (no lo deja en null)');
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exitCode = fallos ? 1 : 0;
