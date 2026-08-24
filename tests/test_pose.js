// =============================================================================
// Test headless (Node) del MODELO DE POSE — TANDA P.
//
// Hasta acá la POSE de una pieza vivía repartida en cuatro mecanismos que no se
// hablaban: `cara` (sup/inf/lateral), `lado` (±1), `plano_pieza.orientacion`
// (acostada/volteada/de_pie) y `orient.deg` con un EJE_ROT por vista en la UI.
// Cada elemento nuevo agregaba casos especiales porque la MISMA información
// —cómo está parada la pieza— se expresaba de tres formas según quién preguntara.
//
// La POSE las unifica en un dato:  pose = { cara, lado, rumbo, espejo }
//   cara ∈ sup | inf | lateral | extremo  (6 caras contando el signo)
//   rumbo = eje LONGITUDINAL, ⊥ a la normal de la cara (los 2 que quedan)
//   espejo = la reflexión que cambia la quiralidad sin tocar dims
//   6 × 2 × 2 = 24 = las orientaciones de una caja.
//
// Lo que se verifica acá:
//   P1 · COMPAT — los campos viejos mapean a la pose equivalente y las recetas
//        existentes generan BYTE-IDÉNTICO (semilla, volteada, de_pie, lateral±).
//   P2 · rotarPose90 — cerrada en las 24, ^4 = identidad, y en CADA paso las
//        caras/pilas/dims se re-derivan solas (host con pilas distintas por cara).
//   P3 · CARA EXTREMO — anclaje real contra el testero (recub_ext + pila ext).
//   P4 · ESPEJO — refleja el trazo sin mover la pieza ni cambiar una dim.
//   P5 · POSES POR DEFECTO del muro (el estribo/amarra con MARCO HORIZONTAL).
//   P6 · FIX 305A — una cadena colocada con tipología ES se traza como cadena.
//   P7 · LADO DOMINANTE — cascada determinista (catálogo → 'B' → 1er parcial).
//   P8 · VIGA-SEMILLA (72 barras / 4 ítems; 140.1 kg con la convención de vértice
//        trazador — ver la nota en P8).
//
// Correr con: node tests/test_pose.js
// =============================================================================

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
const CAT = global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
const FP = global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const SEM = require(path.join(base, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-6); }
function r3(v) { return Math.round(v * 1e3) / 1e3; }
function lim(pl, e) {
  const v = pl.puntos.map(p => p[e]);
  return { lo: r3(Math.min(...v)), hi: r3(Math.max(...v)) };
}
function centro(pl, e) { const l = lim(pl, e); return r3((l.lo + l.hi) / 2); }
function unicos(pls, e) { return [...new Set(pls.map(p => centro(p, e)))].sort((a, b) => a - b); }

const viga = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const muro = { largo: 400, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };

// ===========================================================================
// P1 · COMPATIBILIDAD — campos viejos → pose, y BYTE-IDÉNTICO
// ===========================================================================
// La traducción no es cosmética: `cara` viejo es la cara del MARCO LOCAL y la
// orientación es la permutación de ejes, así que la cara del MUNDO sale de
// componer las dos. Ej.: cara 'lateral' + volteada (x↔z) deja la cara local z
// sobre el eje X del mundo → esa pieza está apoyada contra un TESTERO, que en el
// vocabulario de pose es cara 'extremo'. Ese es justamente el nombre que faltaba.
console.log('P1 — campos viejos → pose (traducción exacta):');
const MAPEO = [
  [{ cara: 'sup' }, { cara: 'sup', lado: 1, rumbo: 'x' }, 'sup'],
  [{ cara: 'inf' }, { cara: 'inf', lado: -1, rumbo: 'x' }, 'inf'],
  [{ cara: 'lateral', lado: 1 }, { cara: 'lateral', lado: 1, rumbo: 'x' }, 'lateral'],
  [{ cara: 'lateral', lado: -1 }, { cara: 'lateral', lado: -1, rumbo: 'x' }, 'lateral'],
  [{ cara: 'sup', plano_pieza: { volteado: true } }, { cara: 'sup', lado: 1, rumbo: 'z' }, 'sup'],
  [{ cara: 'lateral', plano_pieza: { volteado: true } }, { cara: 'extremo', lado: 1, rumbo: 'z' }, 'lateral'],
  [{ cara: 'sup', plano_pieza: { orientacion: 'de_pie' } }, { cara: 'extremo', lado: 1, rumbo: 'y' }, 'sup'],
  [{ cara: 'lateral', lado: -1, plano_pieza: { orientacion: 'de_pie' } }, { cara: 'lateral', lado: -1, rumbo: 'y' }, 'lateral']
];
MAPEO.forEach(function ([viejo, esperada, caraLocal]) {
  const p = R.poseDe(viejo);
  const d = R.derivarPose(p);
  ok(p.cara === esperada.cara && p.lado === esperada.lado && p.rumbo === esperada.rumbo,
    JSON.stringify(viejo) + ' → pose ' + JSON.stringify({ cara: p.cara, lado: p.lado, rumbo: p.rumbo }));
  // …y la vuelta: la cara LOCAL derivada es la misma que traía el campo viejo, que
  // es lo que hace que el resto del motor (marco de cara, plano de trabajo) no
  // note el cambio.
  ok(d.caraLocal === caraLocal, '   …y su cara LOCAL sigue siendo ' + caraLocal + ' (=' + d.caraLocal + ')');
});
// La normal, el longitudinal y la binormal son ejes del mundo con signo, y el
// marco (L, N, B) es DEXTRÓGIRO: cara sup + rumbo x → N=+y, L=+x, B=+z (identidad).
(function () {
  const d = R.derivarPose({ cara: 'sup', lado: 1, rumbo: 'x' });
  ok(d.N.eje === 'y' && d.N.s === 1 && d.L.eje === 'x' && d.B.eje === 'z' && d.B.s === 1,
    'derivarPose(sup,x): N=+y · L=+x · B=L×N=+z (marco dextrógiro = la identidad)');
  ok(d.P === null, '…y su permutación es la IDENTIDAD (ruta sin permutar, como siempre)');
})();
// rumbo ⊥ normal es OBLIGATORIO: uno paralelo se NORMALIZA (no existe una pieza
// que corra en la dirección en la que se apoya).
ok(R.normalizarPose({ cara: 'lateral', rumbo: 'z' }).rumbo === 'x',
  'rumbo paralelo a la normal → se normaliza al default de la cara (lateral/z → x)');
ok(JSON.stringify(R.rumbosDeCara('extremo')) === JSON.stringify(['y', 'z']),
  'los rumbos posibles de la cara extremo son los 2 ejes ⊥ a X (=y,z)');
ok(R.normalizarPose({ cara: 'extremo' }).rumbo === 'y',
  'y su default es Y: un cabezal de borde corre en ALTO (=' + R.normalizarPose({ cara: 'extremo' }).rumbo + ')');

console.log('\nP1b — BYTE-IDÉNTICO: pose explícita == campos viejos equivalentes:');
function cab(extra) {
  return Object.assign({
    tipologia: 'CB', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 10 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 10 } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 4 }
  }, extra || {});
}
MAPEO.forEach(function ([viejo, esperada]) {
  const a = R.expandirComponente(cab(viejo), viga);
  const b = R.expandirComponente(cab({ pose: esperada }), viga);
  ok(JSON.stringify(a) === JSON.stringify(b),
    'placements idénticos: ' + JSON.stringify(viejo) + ' == pose ' + JSON.stringify(esperada));
});
// Y el estribo, que deriva su pose del marco de núcleo y no de una cara.
(function () {
  function es(extra) {
    return Object.assign({
      tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
      dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
      distribucion: { modo: 'linear', sep: 20, rango: { from: -100, to: 100, sep: 20 } }
    }, extra || {});
  }
  ok(JSON.stringify(R.expandirComponente(es(), viga)) ===
    JSON.stringify(R.expandirComponente(es({ pose: { cara: 'lateral', lado: 1, rumbo: 'x' } }), viga)),
    'estribo 104D: la pose explícita da los MISMOS placements que la receta vieja');
  ok(JSON.stringify(R.expandirComponente(es({ plano_pieza: { volteado: true } }), viga)) ===
    JSON.stringify(R.expandirComponente(es({ pose: { cara: 'extremo', lado: 1, rumbo: 'z' } }), viga)),
    'estribo VOLTEADO: idem (volteada + cara lateral ≡ pose cara extremo, rumbo z)');
})();
// La pose NO se estampa como campo enumerable en el componente: si se rellenara,
// un cambio posterior de `cara`/`volteado` quedaría IGNORADO en silencio (la misma
// razón por la que `orientacion` tampoco se rellena). Viaja en `_pose`, no
// enumerable, recalculada en cada pasada.
(function () {
  const c = cab({ cara: 'inf' });
  const antes = JSON.stringify(c);
  R.expandirComponente(c, viga);
  ok(JSON.parse(JSON.stringify(c)).pose === undefined,
    'normalizarComponente NO agrega `pose` enumerable (no ensucia la receta guardada)');
  ok(c._pose && c._pose.cara === 'inf' && Object.keys(c).indexOf('_pose') < 0,
    '…la publica en `comp._pose` (no enumerable) y ahí es la pose EFECTIVA (=' + (c._pose && c._pose.cara) + ')');
  c.cara = 'sup';
  R.expandirComponente(c, viga);
  ok(c._pose.cara === 'sup', '…y se recalcula: cambiar el campo viejo SIGUE teniendo efecto');
  ok(antes.length > 0, 'receta serializable antes y después');
})();
// Cuando el componente SÍ trae `pose`, manda ella y se CANONIZA in place (el lado
// de una cara sup/inf lo impone la cara: no puede haber dos representaciones del
// mismo estado, o el giro de 90° deja de ser cerrado).
(function () {
  const c = {
    tipologia: 'CBI', figura: '101A', diam: 16, pose: { cara: 'inf', lado: 1, rumbo: 'z' },
    dims: { A: { modo: 'auto' } }, distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1 }
  };
  R.normalizarComponente(c);
  ok(c.pose.lado === -1 && c.pose.rumbo === 'z',
    'pose {inf, lado:1} → se canoniza a lado −1 (el rumbo válido no se toca) (=' + JSON.stringify(c.pose) + ')');
  ok(R.poseDe({ pose: { foo: 1 }, cara: 'inf' }).cara === 'inf',
    'una `pose` inservible NO deja al componente sin orientación: se cae a los campos viejos');
})();
// La UI opera sobre la pose: estos tres consultores tienen que responder DESDE
// ella (si leyeran plano_pieza, un componente con pose nueva quedaría mudo).
(function () {
  const c = { pose: { cara: 'lateral', lado: 1, rumbo: 'y' } };
  ok(R.orientacionPieza(c) === 'de_pie' && R.ejeDistribucion(c) === 'y' && R.ejeCapas(c, 'z') === 'z',
    'orientacionPieza / ejeDistribucion / ejeCapas salen de la POSE (rumbo y → de_pie, reparte en Y)');
  ok(R.estaVolteado({ pose: { cara: 'sup', lado: 1, rumbo: 'z' } }) === true,
    'y `estaVolteado` sigue siendo "rumbo z" (compat del botón viejo de la UI)');
})();

// ===========================================================================
// P1c · CAMBIO DE COMPORTAMIENTO DOCUMENTADO — las recetas que SÍ se mueven
// ===========================================================================
// La tanda mantiene BYTE-IDÉNTICA la viga-semilla (P8) y toda receta cuya ruta de
// dibujo no cambió, y mueve A PROPÓSITO dos familias (hallazgo D5 del verificador,
// evaluado y confirmado como intencional):
//   (1) las de rol CABEZAL cuya pose traducida tiene la normal en X — las que
//       quedan apoyadas contra un TESTERO (lo que documenta y mide este bloque);
//   (2) las CADENAS colocadas como pieza de sección, que con el fix 305A dejaron de
//       trazarse como longitudinal transpuesto (P6) y con el lado dominante
//       determinista cambian además qué lado estira el 'auto' (P7).
//
// ALCANCE MEDIDO — y no son "4 recetas". Enumerar tres casos describía el TIPO de
// cambio, no su tamaño. Barrido contra HEAD de 1860 recetas de CAMPOS VIEJOS (sin
// `pose`): 62 figuras dibujables × 5 tipologías/caras (CBS·sup, CBI·inf, LT·lateral,
// ES·lateral, TRV·lateral) × 3 orientaciones (acostada/volteada/de_pie) × 2 juegos
// de dims (todo AUTO / todo FIJA 30), φ12, layered 2 capas × 2 barras, gap 4, sobre
// la viga 600×60×30 recub 4/4/3:
//   · 770 de 1860 salen distintas de HEAD →  662 cambian SÓLO de posición (familia 1)
//     y 108 cambian dims Y posición (familia 2). La TRABA (TRV) no cambia en ninguna:
//     su ruta de dibujo no se tocó.
//   · 82 de esas 770 sacan MÁS fierro fuera del hormigón que HEAD: 77 son dims
//     'fija' —el usuario fijó medidas que no caben en el marco y ahora se ven
//     asomar, que es el dato honesto— y las 5 restantes son la MISMA 106A de rol
//     cabezal que en HEAD ya asomaba 0.7 cm acostada, y que ahora asoma igual
//     volteada y de pie porque queda anclada al testero en vez de recentrada.
//   · con dims AUTO, que es como nace una pieza en el editor, el saldo va al revés:
//     las piezas de SECCIÓN quedan en 0 cm fuera (guarda de P6) contra los 113 de
//     1116 casos que asomaban —hasta 294 cm— con el primer fix del defecto D1.
//
// POR QUÉ SE MUEVEN. `cara` viejo es la cara del marco LOCAL: componerla con la
// permutación de la orientación puede dejarla mirando al eje X (cara sup + de_pie,
// cara lateral + volteada). Esa pieza está ANCLADA al testero — su coordenada en X
// la deriva _marcoCara del recubrimiento + las pilas, igual que un cabezal superior
// deriva su Y. Antes, _restituirCentroVolteo la arrastraba al CENTRO del elemento
// porque en ese eje la pieza es "puntual": el anclaje se calculaba y acto seguido se
// destruía, y la barra terminaba flotando en mitad de la viga sin apoyarse en nada.
// Es el MISMO defecto que hacía imposible el cabezal de borde de muro de P3, así que
// arreglarlo allá y dejarlo acá habría sido dos verdades distintas para un solo
// motor. El eje de la normal se excluye de la restitución sólo para rol cabezal
// (estribo/traba encuadran el marco de núcleo, no una cara: siguen igual).
//
// QUÉ CAMBIA Y QUÉ NO — medido en la viga 600×60×30 (recub 4/4/3), ANTES → DESPUÉS:
//   CBS 103B φ16 · cara sup + de_pie      x [−13, 17]  →  [265.2, 295.2]  (testero +X)
//   CBI 101A φ18 · cara inf + de_pie      x 0          →  −295.1          (testero −X)
//   LT  101A φ8  · cara lateral± volteada x 0          →  ±295.6          (testero ±X)
// En estas tres —y en las 662 de su familia— NO cambian ni el nº de barras, ni las
// dims, ni el peso: cambia SÓLO la POSICIÓN, que es justamente lo que estaba mal.
// Y no toca la viga-semilla (P8): sus cuatro componentes son 'acostada', donde la
// normal nunca cae en X.
console.log('\nP1c — recetas viejas que se MUEVEN a propósito (anclaje al testero):');
(function () {
  function mide(c) {
    const pl = R.expandirComponente(c, viga);
    return { n: pl.length, x: lim(pl[0], 'x'), dims: JSON.stringify(pl[0].dims) };
  }
  const cbs = mide({
    tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
    plano_pieza: { orientacion: 'de_pie' },
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 4, sentido: 'nucleo' }
  });
  // MIGRACIÓN CABEZAL → TRAZADOR: lo que este assert protege es el ANCLAJE (la
  // pieza queda pegada al testero +X en 295.2, no arrastrada al centro) y eso no se
  // mueve. Lo que sí cambia son las dos medidas que dependían de dibujar las patas
  // a 90°:
  //   · x.lo: la pata de 30 corre por la NORMAL de la cara (aquí, X) y con 45° sólo
  //     cruza 30·cos45 = 21.2132 → punta en 295.2 − 21.2132 = 273.987, no 265.2.
  //   · B: el auto se mide contra el mismo marco de siempre (alto útil 52) pero
  //     ahora RESERVA lo que las patas ocupan sobre el eje del cuerpo: 21.2132 de
  //     proyección + φ/2 = 0.8 de la cresta del codo, por punta → B = 52 − 44.0264
  //     = 7.9736. Es una 103B de patas de 30 metida en 52 cm de alto útil: casi
  //     todo el material se lo llevan las patas, y eso ahora se VE en la dim.
  // 18-AGO · CONVENCIÓN DE VÉRTICE (cerrada por el usuario). Los 45° de la 103B son
  // el ángulo ENTRE la pata y el cuerpo, o sea la pata queda REPLEGADA (recorrido
  // 135°) en vez de abierta. Dos consecuencias medidas, y las dos son el cambio
  // pedido:
  //   · B: la pata replegada NO avanza sobre el eje del cuerpo —vuelve sobre él—, así
  //     que la reserva por punta cae de 22.0132 (21.2132 de proyección + 0.8 de
  //     cresta) a sólo la cresta, φ/2 = 0.8 → B = 52 − 1.6 = 50.4, no 7.974. La
  //     103B de patas de 30 en 52 cm de alto útil ya no se come casi todo el cuerpo.
  //   · x.lo: la punta ya no cae a 30·cos45 del testero. El doblez pasó a 135° de
  //     recorrido, o sea lo dibuja el codo arqueado: la pata cuelga tangente a la
  //     salida del arco, desplazada R = 2·φ + φ/2 = 4 cm respecto de la cadena de
  //     vértices. Alcance = 30·sin45 + R·(1 + cos45) = 21.2132 + 6.8284 = 28.0416
  //     → punta en 295.2 − 28.0416 = 267.158 (antes 273.987).
  // 20-AGO · MEDIDA HASTA LA CRESTA. Dos consecuencias en este mismo caso:
  //   · B (auto) suma el R + φ de sus dos codos, que es justo lo que la reserva le
  //     quitaba → 52 exactos, el alto útil (y el redondeo al centímetro no lo mueve);
  //   · la pata FIJA de 30 ahora se mide HASTA LA CRESTA, o sea su tramo recto es
  //     30 − (R + φ) = 25.2. La barra que se corta mide lo mismo que antes; lo que
  //     cambió es que ese número ya incluye el doblez, así que el trazo alcanza
  //     25.2·sin45 + R·(1 + cos45) = 24.647 y la punta queda en 270.553.
  const sobCBS = FP.sobresCresta('103B', 'cabezal', 1.6, [45, 45]);
  const R_CODO_CBS = 2 * 1.6 + 1.6 / 2;              // 4.0 con φ16
  const ALCANCE_PATA = (30 - sobCBS.A) * Math.SQRT1_2 + R_CODO_CBS * (1 + Math.SQRT1_2);
  ok(cbs.n === 6 && close(cbs.x.lo, r3(295.2 - ALCANCE_PATA)) && close(cbs.x.hi, 295.2) &&
    close(JSON.parse(cbs.dims).B, 52) &&
    JSON.parse(cbs.dims).A === 30 && JSON.parse(cbs.dims).C === 30,
    'CBS 103B sup+de_pie: pegada al testero +X (x.hi 295.2, punta 270.553) · 6 barras · patas 30/30 y B = 52 = el alto útil (=' +
    JSON.stringify(cbs.x) + ' ' + cbs.dims + ')');
  const cbi = mide({
    tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf', plano_pieza: { orientacion: 'de_pie' },
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 4, gap: 0, sentido: 'nucleo' }
  });
  ok(cbi.n === 4 && close(cbi.x.lo, -295.1) && cbi.dims === JSON.stringify({ A: 52 }),
    'CBI 101A inf+de_pie: x 0 → −295.1 (testero −X, porque la cara INF da normal −) · A = 52 (=' +
    JSON.stringify(cbi.x) + ')');
  const ltp = mide({
    tipologia: 'LT', figura: '101A', diam: 8, cara: 'lateral', lado: 1,
    plano_pieza: { orientacion: 'volteada' }, dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 200 }], start_offset: 4 }
  });
  const ltn = mide({
    tipologia: 'LT', figura: '101A', diam: 8, cara: 'lateral', lado: -1,
    plano_pieza: { orientacion: 'volteada' }, dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 200 }], start_offset: 4 }
  });
  ok(close(ltp.x.lo, 295.6) && close(ltn.x.lo, -295.6) && ltp.dims === ltn.dims,
    'LT 101A lateral± + volteada: x 0 → ±295.6, y el `lado` elige QUÉ testero (=' +
    ltp.x.lo + ' / ' + ltn.x.lo + ')');
  // La contracara: una receta 'acostada' —la inmensa mayoría, y toda la semilla— NO
  // se mueve ni un micrón, porque su normal no cae en X y la restitución sigue igual.
  const acostada = mide({
    tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 4, sentido: 'nucleo' }
  });
  // Sigue de borde a borde y sigue SIMÉTRICA (que es lo que este assert protege:
  // la restitución de centro no la tocó). El ±296 pasa a ±295.2 por la migración:
  // con las patas a 45° el extremo del trazo ya no es el vértice del codo sino su
  // CRESTA, que tiene que quedar EN LÍNEA con el recub de extremo → el eje se
  // retira φ/2 = 0.8 (295.2 = 300 − 4 − 0.8). Con ±296 el eje llegaba justo al
  // recubrimiento y la superficie del codo se metía 0.8 dentro de él.
  ok(close(acostada.x.lo, -295.2) && close(acostada.x.hi, 295.2),
    '…y la MISMA receta acostada sigue de borde a borde y simétrica (=' + JSON.stringify(acostada.x) + ')');
})();

// ===========================================================================
// P2 · ROTAR-EN-VISTA — rotarPose90, cerrada en las 24 y de ORDEN 4
// ===========================================================================
// EL ORDEN TIENE QUE SER 4, NO "DIVISOR DE 4" (defecto D4 del verificador).
// La versión anterior de este bloque sólo comprobaba giro⁴ = identidad, y eso lo
// cumple igual una órbita de orden 2: en 24 de las 72 (las que giran en torno a la
// PROPIA normal de la pieza) el giro alternaba dos poses y la MEDIA VUELTA era
// inalcanzable con la tecla R. La causa era que el rumbo es un eje sin signo y
// rotarPose90 tiraba el signo del longitudinal en vez de escribirlo en `espejo`
// (ver _signoLong en reglas.js). Contar el orden REAL es lo que hace visible eso.
console.log('\nP2 — rotarPose90(pose, ejeMundo): cerrada en las 24 · orden exacto 4:');
// Las 24 poses CANÓNICAS distintas: sup/inf no tienen `lado` propio (lo impone la
// cara), así que enumerar los dos daría duplicados — se deduplica por la pose
// normalizada, que es la representación única de cada estado.
const POSES_24 = (function () {
  const m = new Map();
  R.CARAS_POSE.forEach(function (cara) {
    [1, -1].forEach(function (lado) {
      R.rumbosDeCara(cara).forEach(function (rumbo) {
        [false, true].forEach(function (espejo) {
          const p = R.normalizarPose({ cara: cara, lado: lado, rumbo: rumbo, espejo: espejo });
          m.set(JSON.stringify(p), p);
        });
      });
    });
  });
  return [...m.values()];
})();
ok(POSES_24.length === 24,
  'el modelo enumera EXACTAMENTE las 24 orientaciones de una caja (=' + POSES_24.length + ')');
(function () {
  const ordenes = {};
  let fuera = 0, malOrden = [];
  ['x', 'y', 'z'].forEach(function (eje) {
    POSES_24.forEach(function (p0) {
      const k0 = JSON.stringify(p0);
      let p = p0, n = 0;
      do {
        p = R.rotarPose90(p, eje);
        n++;
        // cada paso sigue siendo una pose VÁLIDA de las 24
        if (R.CARAS_POSE.indexOf(p.cara) < 0 || R.rumbosDeCara(p.cara).indexOf(p.rumbo) < 0) {
          fuera++;
          ok(false, 'giro en ' + eje + ' desde ' + k0 + ' salió del grupo: ' + JSON.stringify(p));
        }
      } while (JSON.stringify(p) !== k0 && n < 12);
      ordenes[n] = (ordenes[n] || 0) + 1;
      if (n !== 4 && malOrden.length < 5) malOrden.push(k0 + ' en ' + eje + ' → orden ' + n);
    });
  });
  ok(fuera === 0 && JSON.stringify(ordenes) === JSON.stringify({ 4: 72 }),
    'las 24 poses × 3 ejes = 72 órbitas, TODAS de orden 4 (=' + JSON.stringify(ordenes) +
    (malOrden.length ? ' · ' + malOrden.join(' · ') : '') + ')');
})();
// …y el marco (N, L, B) que publica derivarPose SIGUE al giro con su signo: si L se
// publicara siempre en +1, B = L×N saldría invertida en la mitad de los giros.
(function () {
  const ROT = {
    x: { x: { eje: 'x', s: 1 }, y: { eje: 'z', s: 1 }, z: { eje: 'y', s: -1 } },
    y: { y: { eje: 'y', s: 1 }, z: { eje: 'x', s: 1 }, x: { eje: 'z', s: -1 } },
    z: { z: { eje: 'z', s: 1 }, x: { eje: 'y', s: 1 }, y: { eje: 'x', s: -1 } }
  };
  const gira = (v, e) => ({ eje: ROT[e][v.eje].eje, s: v.s * ROT[e][v.eje].s });
  const igual = (a, b) => a.eje === b.eje && a.s === b.s;
  let malL = 0, malB = 0, malN = 0, ej = '';
  POSES_24.forEach(function (p0) {
    ['x', 'y', 'z'].forEach(function (e) {
      const d0 = R.derivarPose(p0);
      const d1 = R.derivarPose(R.rotarPose90(d0.pose, e));
      if (!igual(d1.N, gira(d0.N, e))) malN++;
      if (!igual(d1.L, gira(d0.L, e))) {
        malL++;
        if (!ej) ej = JSON.stringify(d0.pose) + ' rot' + e + ': L=' + JSON.stringify(d1.L) +
          ' ≠ ' + JSON.stringify(gira(d0.L, e));
      }
      if (!igual(d1.B, gira(d0.B, e))) malB++;
    });
  });
  ok(malN === 0 && malL === 0 && malB === 0,
    'tras cada giro, N/L/B de derivarPose son los ejes GIRADOS con su signo (fallos N=' +
    malN + ' L=' + malL + ' B=' + malB + (ej ? ' · ' + ej : '') + ')');
})();
// LA MEDIA VUELTA EXISTE Y SE VE. Con una figura ASIMÉTRICA (102A: una sola pata)
// los 4 estados del giro en torno a la normal son 4 barras DISTINTAS, y la 2ª es la
// pieza dada vuelta (la pata pasa de un extremo al otro). Con el bug D4 los estados
// 2 y 4 no existían: R alternaba entre dos y la barra nunca se daba vuelta.
(function () {
  const barra102 = (pose) => R.expandirComponente({
    tipologia: 'CB', figura: '102A', diam: 16, pose: pose,
    dims: { A: { modo: 'fija', valor: 20 }, B: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  }, viga)[0];
  const patas = [], vistos = new Set();
  let p = { cara: 'sup', lado: 1, rumbo: 'x', espejo: false };
  const ini = JSON.stringify(barra102(p).puntos);
  for (let i = 0; i < 4; i++) {
    p = R.rotarPose90(p, 'y');                       // Y = la NORMAL de esta pieza
    const b = barra102(p);
    vistos.add(JSON.stringify(b.puntos));
    patas.push(r3(b.puntos[0].x) + '/' + r3(b.puntos[0].z));
  }
  // MIGRACIÓN CABEZAL → TRAZADOR: ±296 → ±295.6. La 102A tiene UNA pata (extremo
  // inicial), así que el auto-largo reserva φ/2 = 0.8 SÓLO en ese extremo —la
  // cresta del codo tiene que quedar en línea con el recub, la punta recta del
  // otro extremo no dobla contra nada— y B pasa de 592 a 591.2.
  // 23-AGO · 295.6 → 295.2, Y ESTE NÚMERO ES EL BUENO. La cadena se centraba por el
  // bbox de los EJES, así que esos 0.8 reservados para UNA punta se repartían 0.4 y
  // 0.4: la cresta del codo acababa en 296.4 —0.4 DENTRO del recubrimiento— y la
  // punta recta en 295.6, con 0.4 de sobra. Ahora cada punta lleva SU reserva: el
  // eje del codo a 295.2 (cresta en 296 = recub 4 EXACTO) y el corte a ras en 296.
  // Lo que el assert protege —que la MEDIA VUELTA existe y lleva la pata de un
  // testero al otro— es exactamente lo mismo.
  ok(vistos.size === 4 && patas[1] === '295.2/0',
    'girando en torno a su normal la 102A pasa por 4 barras distintas y la MEDIA VUELTA ' +
    'lleva la pata de x=−295.2 a x=+295.2 (=' + patas.join(' · ') + ')');
  ok(JSON.stringify(barra102(p).puntos) === ini,
    '…y la 4ª devuelve la barra BYTE-IDÉNTICA a la de partida');
})();
// Los 4 pasos concretos del giro en Z desde la pose de un cabezal superior.
(function () {
  const pasos = [];
  let p = { cara: 'sup', lado: 1, rumbo: 'x', espejo: false };
  for (let i = 0; i < 4; i++) { p = R.rotarPose90(p, 'z'); pasos.push(p.cara + (p.lado < 0 ? '−' : '+') + '/' + p.rumbo); }
  ok(JSON.stringify(pasos) === JSON.stringify(['extremo−/y', 'inf−/x', 'extremo+/y', 'sup+/x']),
    'sup/x --z--> extremo−/y → inf/x → extremo+/y → sup/x (=' + pasos.join(' → ') + ')');
})();

console.log('\nP2b — en CADA paso las caras/pilas/dims se re-derivan solas:');
// Host con una pila DISTINTA por cara (nivel 1): sup 2.0 · inf 1.0 · lat 0.6 · ext 1.4.
// Una barra de nivel 2 se apoya sobre la pila de LA CARA QUE LE TOCA en cada pose;
// si la pose no gobernara de verdad, alguna de estas 4 mediciones saldría con la
// pila de otra cara.
const vigaPilas = Object.assign({}, viga, {
  jer_caras: { sup: [0, 2.0], inf: [0, 1.0], lat: [0, 0.6], ext: [0, 1.4] }
});
function barraPose(pose, host) {
  return R.expandirComponente({
    tipologia: 'CB', figura: '101A', diam: 16, pose: pose, jerarquia: 2,
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  }, host || vigaPilas)[0];
}
// Números a mano (φ16 → φ/2 = 0.8):
//   sup/x  : A = 600 − 2·(recub_ext 4 + pila ext 1.4) = 589.2 · y = 30 − (4+2.0) − 0.8 = 23.2
//   extremo/y: A = 60 − 2·(recub y 4 + pila y 2.0) = 48 · x = 300 − (4+1.4) − 0.8 = 293.8
//   inf/x  : A = 589.2 · y = −(30 − (4+1.0) − 0.8) = −24.2   ← pila INF, no la sup
const g0 = barraPose({ cara: 'sup', lado: 1, rumbo: 'x' });
const g1 = barraPose({ cara: 'extremo', lado: -1, rumbo: 'y' });
const g2 = barraPose({ cara: 'inf', lado: -1, rumbo: 'x' });
const g3 = barraPose({ cara: 'extremo', lado: 1, rumbo: 'y' });
// 20-AGO: la 101A es recta (sin dobleces → sin sobre de cresta), pero su 'auto' lo
// limita el hormigón y se redondea al centímetro hacia ABAJO: 589.2 → 589.
ok(close(g0.dims.A, Math.floor(589.2)) && close(lim(g0, 'y').hi, 23.2),
  'sup/x: A = 600 − 2·(4 + pila ext 1.4) = 589.2, al centímetro hacia abajo = 589 · y = 23.2 (pila SUP) (=' + g0.dims.A + '/' + lim(g0, 'y').hi + ')');
ok(close(g1.dims.A, 48) && close(lim(g1, 'x').lo, -293.8),
  'extremo−/y: A = 60 − 2·(4 + pila y 2.0) = 48 · x = −293.8 (pila EXT) (=' + g1.dims.A + '/' + lim(g1, 'x').lo + ')');
ok(close(lim(g2, 'y').lo, -24.2),
  'inf/x: y = −24.2 → se apoya en la pila INFERIOR (1.0), no en la superior (=' + lim(g2, 'y').lo + ')');
ok(close(lim(g3, 'x').hi, 293.8), 'extremo+/y: el testero opuesto, x = +293.8 (=' + lim(g3, 'x').hi + ')');
// El ciclo completo devuelve la MISMA barra (no sólo la misma pose).
(function () {
  let p = { cara: 'sup', lado: 1, rumbo: 'x', espejo: false };
  const ini = JSON.stringify(barraPose(p));
  for (let i = 0; i < 4; i++) p = R.rotarPose90(p, 'z');
  ok(JSON.stringify(barraPose(p)) === ini,
    'y 4 giros de 90° en Z devuelven la barra BYTE-IDÉNTICA (no sólo la pose)');
})();

// ===========================================================================
// P3 · CARA EXTREMO — anclaje contra los testeros
// ===========================================================================
// «Un cabezal de borde de muro (corre en y, pegado al testero) debe salir natural».
// Muro 400×250×20, recub bordes 3 / caras 2.5, φ16.
//   corre en Y  → A auto = 250 − 2·3 = 244
//   pegado al testero +X → x = 200 − 3 − 0.8 = 196.2
console.log('\nP3 — CARA EXTREMO (los testeros ±x):');
const cbBorde = R.expandirComponente({
  tipologia: 'CB', figura: '101A', diam: 16, jerarquia: 2,
  pose: { cara: 'extremo', lado: 1, rumbo: 'y' },
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0 }
}, muro);
ok(cbBorde.length === 2 && close(cbBorde[0].dims.A, 244),
  'cabezal de borde: corre en Y de borde a borde, A = 250 − 2·3 = 244 (=' + cbBorde[0].dims.A + ')');
ok(close(lim(cbBorde[0], 'x').lo, 196.2) && close(lim(cbBorde[0], 'x').hi, 196.2),
  'PEGADO al testero +X: x = 200 − recub_ext 3 − φ/2 = 196.2 (=' + lim(cbBorde[0], 'x').hi + ')');
ok(close(lim(cbBorde[0], 'y').lo, -122) && close(lim(cbBorde[0], 'y').hi, 122),
  'y corre en Y de −122 a 122 (=' + JSON.stringify(lim(cbBorde[0], 'y')) + ')');
ok(JSON.stringify(unicos(cbBorde, 'z')) === JSON.stringify([-6.7, 6.7]),
  'las 2 barras de la capa se reparten en el ESPESOR (z ±6.7 = ±(10 − 2.5 − 0.8)) (=' +
  JSON.stringify(unicos(cbBorde, 'z')) + ')');
// LA PILA DEL TESTERO — `jer_caras.ext` ya existía y nadie la usaba como cara de
// anclaje: una barra de nivel 2 tiene que apoyarse SOBRE ella.
const muroPila = Object.assign({}, muro, { jer_caras: { sup: [0, 0], inf: [0, 0], lat: [0, 0], ext: [0, 1.0] } });
const cbPila = R.expandirComponente({
  tipologia: 'CB', figura: '101A', diam: 16, jerarquia: 2,
  pose: { cara: 'extremo', lado: 1, rumbo: 'y' },
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
}, muroPila);
ok(close(lim(cbPila[0], 'x').hi, 195.2),
  'con pila ext[1] = 1.0 la barra de nivel 2 entra 1 cm: x = 200 − (3 + 1.0) − 0.8 = 195.2 (=' +
  lim(cbPila[0], 'x').hi + ')');
const cbNeg = R.expandirComponente({
  tipologia: 'CB', figura: '101A', diam: 16, jerarquia: 2,
  pose: { cara: 'extremo', lado: -1, rumbo: 'y' },
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
}, muroPila);
ok(close(lim(cbNeg[0], 'x').lo, -195.2),
  'lado −1 → el testero opuesto, x = −195.2 (la cara extremo es un PAR, como lateral)');
// CAMBIO DE COMPORTAMIENTO DOCUMENTADO: la restitución del centro tras permutar NO
// toca el eje de la NORMAL cuando la pieza se APOYA en una cara (rol cabezal). Antes
// arrastraba al centro cualquier eje donde la pieza fuera "puntual", y eso destruía
// justamente este anclaje (el cabezal de borde salía en x = 0, en mitad del muro).
// Estribo/traba no tienen eje de anclaje (encuadran el marco) → siguen igual.
ok(Math.abs(centro(cbBorde[0], 'x')) > 100,
  'la restitución de centro ya no arrastra al medio un anclaje de cara (x=' + centro(cbBorde[0], 'x') + ')');

// ===========================================================================
// P4 · ESPEJO — refleja el trazo, sin mover la pieza ni cambiar dims
// ===========================================================================
console.log('\nP4 — ESPEJO (misma barra, orientación especular):');
// (a) CADENA / cabezal con patas: su plano es (L, N) y el espejo invierte L → la
//     pata que estaba al inicio queda al final.
const dims102 = { A: { modo: 'fija', valor: 20 }, B: { modo: 'auto' } };
const dist1 = { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 };
const n102 = R.expandirComponente(cab({ figura: '102A', dims: dims102, distribucion: dist1 }), viga)[0];
const e102 = R.expandirComponente(cab({
  figura: '102A', pose: { cara: 'sup', lado: 1, rumbo: 'x', espejo: true }, dims: dims102, distribucion: dist1
}), viga)[0];
// ±296 → ±295.2: la 102A reserva φ/2 = 0.8 en su ÚNICO extremo con doblez (la
// cresta del codo va en línea con el recub) y esa reserva la lleva ESE extremo, no
// media cada uno — antes se repartía 0.4 y 0.4 y el codo se metía 0.4 en el
// recubrimiento (ver la nota del giro, más arriba). El espejo, que es lo que se
// mide acá, no cambia: la pata sigue saltando de un testero al otro.
ok(close(n102.puntos[0].x, -295.2) && close(e102.puntos[0].x, 295.2),
  '102A: la pata pasa del extremo −X al +X (=' + r3(n102.puntos[0].x) + ' → ' + r3(e102.puntos[0].x) + ')');
ok(JSON.stringify(n102.dims) === JSON.stringify(e102.dims),
  'y las dims NO cambian: es la MISMA barra (=' + JSON.stringify(e102.dims) + ')');
// …y TAMPOCO SE MUEVE: la reflexión es sobre su propio plano medio, así que la
// pieza ocupa el MISMO sitio. Lo que se compara es el bbox del ACERO —la cresta del
// codo por un lado y el corte a ras por el otro, ±296 en los dos casos—, no el de
// los ejes: con una punta doblada y la otra cortada el eje NO es simétrico (295.2
// contra 296), y exigir que el bbox de ejes coincida era exigir el defecto de antes.
ok(close(lim(n102, 'x').lo, -lim(e102, 'x').hi) && close(lim(n102, 'x').hi, -lim(e102, 'x').lo) &&
  close(lim(n102, 'y').lo, lim(e102, 'y').lo) && close(lim(n102, 'y').hi, lim(e102, 'y').hi),
  'tampoco se MUEVE: el acero ocupa lo mismo, con el eje espejado punta por punta ' +
  '(x ' + r3(lim(n102, 'x').lo) + '…' + r3(lim(n102, 'x').hi) + ' vs ' +
  r3(lim(e102, 'x').lo) + '…' + r3(lim(e102, 'x').hi) + ')');
// (b) ESTRIBO: su plano es la SECCIÓN y el espejo invierte la binormal → los
//     ganchos cambian de esquina.
const dimsES = { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } };
const distES = { modo: 'linear', rango: { from: 0, to: 0, sep: 20 } };
const nEs = R.expandirComponente({ tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', dims: dimsES, distribucion: distES }, viga)[0];
const eEs = R.expandirComponente({
  tipologia: 'ES', figura: '104D', diam: 8,
  pose: { cara: 'lateral', lado: 1, rumbo: 'x', espejo: true }, dims: dimsES, distribucion: distES
}, viga)[0];
ok(close(nEs.puntos[0].z, -eEs.puntos[0].z) && Math.abs(nEs.puntos[0].z) > 1,
  'estribo 104D: la punta del gancho pasa de z = ' + r3(nEs.puntos[0].z) + ' a ' + r3(eEs.puntos[0].z));
ok(JSON.stringify(nEs.dims) === JSON.stringify(eEs.dims) &&
  close(lim(nEs, 'z').lo, lim(eEs, 'z').lo) && close(lim(nEs, 'y').hi, lim(eEs, 'y').hi),
  'mismas dims y mismo bbox: sólo cambia de mano (=' + JSON.stringify(eEs.dims) + ')');
// (c) el espejo es INVOLUTIVO: espejar dos veces es no espejar.
(function () {
  const p2 = R.normalizarPose({ cara: 'sup', lado: 1, rumbo: 'x', espejo: true });
  const dosVeces = R.expandirComponente(cab({
    figura: '102A', pose: { cara: 'sup', lado: 1, rumbo: 'x', espejo: !p2.espejo }, dims: dims102, distribucion: dist1
  }), viga)[0];
  ok(JSON.stringify(dosVeces.puntos) === JSON.stringify(n102.puntos),
    'espejo:false vuelve exactamente al trazo original (la reflexión es involutiva)');
})();
// (d) el espejo VIAJA en la pose al girar — pero no es un flag inerte, y decir
//     "giro y reflexión son cosas distintas" contradecía el fundamento del fix D4.
//     En este modelo `espejo` ES EL SIGNO DEL LONGITUDINAL: `rumbo` nombra un eje
//     SIN signo, y el signo que sobra es exactamente lo que _signoLong escribe en
//     `espejo` (sin eso, el giro tenía órbitas de orden 2 y la media vuelta era
//     inalcanzable). Consecuencia obligada: un giro que INVIERTE el longitudinal
//     da vuelta el flag, y la pieza girada sigue siendo la misma.
//       · en torno a Z: x → y, el longitudinal no cambia de signo → se CONSERVA;
//       · en torno a Y: x → −z, el longitudinal cambia de signo → se DA VUELTA.
(function () {
  const gz = R.rotarPose90({ cara: 'sup', lado: 1, rumbo: 'x', espejo: true }, 'z');
  const gy = R.rotarPose90({ cara: 'sup', lado: 1, rumbo: 'x', espejo: true }, 'y');
  const gy0 = R.rotarPose90({ cara: 'sup', lado: 1, rumbo: 'x', espejo: false }, 'y');
  ok(gz.espejo === true && gy.espejo === false && gy0.espejo === true,
    'el espejo es el SIGNO del longitudinal: girando en Z se conserva y girando en Y se da vuelta (=' +
    gz.espejo + ' / ' + gy.espejo + ' / ' + gy0.espejo + ')');
})();
// (e) CADENA del trazador genérico (104B, 4 tramos con quiebres de 45°): el espejo
//     vale para CUALQUIER familia, no sólo para el cabezal de 3 lados.
(function () {
  function cad(espejo) {
    return R.expandirComponente({
      tipologia: 'CB', figura: '104B', diam: 16, cara: 'sup', angulos: [45, 45],
      pose: { cara: 'sup', lado: 1, rumbo: 'x', espejo: espejo },
      dims: {
        A: { modo: 'fija', valor: 30 }, B: { modo: 'fija', valor: 400 },
        C: { modo: 'fija', valor: 30 }, D: { modo: 'fija', valor: 40 }
      },
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
    }, viga)[0];
  }
  const nc = cad(false), ec = cad(true);
  ok(nc.puntos.every((p, i) => close(p.x, -ec.puntos[i].x) && close(p.y, ec.puntos[i].y)),
    'cadena 104B: cada punto se refleja en X y conserva su Y (el trazo cambia de mano)');
  ok(JSON.stringify(nc.dims) === JSON.stringify(ec.dims) &&
    close(lim(nc, 'x').lo, lim(ec, 'x').lo) && close(lim(nc, 'x').hi, lim(ec, 'x').hi),
    'y ni las dims ni el bbox se mueven (=' + JSON.stringify(ec.dims) + ')');
})();

// ===========================================================================
// P5 · POSES POR DEFECTO — tabla de DATOS elemento × tipología
// ===========================================================================
console.log('\nP5 — POSES_DEFAULT (muro: el estribo con MARCO HORIZONTAL):');
ok(JSON.stringify(R.poseDefault('viga', 'CBS')) === JSON.stringify({ cara: 'sup', lado: 1, rumbo: 'x', espejo: false }) &&
  R.poseDefault('viga', 'CBI').cara === 'inf' && R.poseDefault('viga', 'ES').rumbo === 'x',
  'VIGA = exactamente lo de hoy (CBS sup/x · CBI inf/x · ES lateral/x)');
ok(R.poseDefault('muro', 'MH').cara === 'lateral' && R.poseDefault('muro', 'MH').rumbo === 'x',
  'MURO/MH: malla horizontal = cortina que corre a lo LARGO (lateral, rumbo x)');
ok(R.poseDefault('muro', 'MV').cara === 'lateral' && R.poseDefault('muro', 'MV').rumbo === 'y',
  'MURO/MV: la misma cortina DE PIE (lateral, rumbo y)');
// LA TRABA CRUZA EL ESPESOR — y esta aserción ya cambió DOS VECES, así que vale la
// pena dejar escrito por qué la de hoy no es otra vuelta más:
//   · {extremo, rumbo z}   — hasta el 13-ago. Cuerpo en z pero con la cara
//     equivocada: las cerradas salían planas (TC 104B resolvía 244×4).
//   · {lateral, rumbo y}   — 13-ago. Correcta SÓLO mientras la traba fuera PIEZA DE
//     SECCIÓN: ahí el rumbo es el eje por el que la pieza se REPITE y su plano
//     —perpendicular al rumbo— contiene el espesor.
//   · {sup, rumbo z}       — hoy. El 14-ago, en Modelo A, la traba dejó de ser pieza
//     de sección (`esPiezaDeSeccion` pasó a exigir rol estribo): el rumbo volvió a
//     significar «por dónde corre la barra», y con rumbo y la traba nacía DE PIE,
//     de 244 cm, en el plano de la cara. Medido con un 103B como TR en un muro
//     600×250×20, y reportado por el usuario. Con rumbo z el cuerpo mide 15 —el
//     espesor menos los recubrimientos— que es lo que una traba mide.
// La lección: esta pose y `esPiezaDeSeccion` están acopladas. Si alguna vez se
// vuelve a mover una, hay que mirar la otra.
ok(R.poseDefault('muro', 'TR').cara === 'sup' && R.poseDefault('muro', 'TR').rumbo === 'z',
  'MURO/TR: la traba cose las dos cortinas cruzando el espesor (sup, rumbo z)');
ok(R.poseDefault('muro', 'TC').rumbo === 'z' && R.poseDefault('muro', 'TM').rumbo === 'z',
  'MURO/TC y TM: lo mismo — son trabas, no dependen de la figura que se les ponga');
ok(R.poseDefault('muro', 'CB').cara === 'extremo' && R.poseDefault('muro', 'CB').rumbo === 'y',
  'MURO/CB: cabezal de borde = pegado al TESTERO, corriendo en alto (extremo, rumbo y)');
ok(R.poseDefault('viga', 'XXX') === null && R.poseDefault('OTRA', 'CBS') === null,
  'lo que la tabla no conoce devuelve null (el llamador cae a sus defaults; no se inventa una pose)');
// EL BUG REPORTADO: la amarra/estribo de muro salía con el marco VERTICAL. Su pose
// correcta es la de_pie del estribo: MARCO EN EL PLANO HORIZONTAL (x,z), repartido
// en altura (y).
const poseEC = R.poseDefault('muro', 'EC');
ok(poseEC.rumbo === 'y', 'MURO/EC: rumbo y → su marco es ⊥ Y, o sea HORIZONTAL (=' + poseEC.rumbo + ')');
const ec = R.expandirComponente({
  tipologia: 'EC', figura: '104D', diam: 8, pose: poseEC, dims: dimsES,
  distribucion: { modo: 'linear', sep: 50, rango: { eje: 'y', from: -100, to: 100, sep: 50 } }
}, muro);
ok(ec.length === 5 && JSON.stringify(unicos(ec, 'y')) === JSON.stringify([-100, -50, 0, 50, 100]),
  'la amarra se reparte EN ALTURA: 5 marcos en y = −100…100 (=' + JSON.stringify(unicos(ec, 'y')) + ')');
ok(close(lim(ec[0], 'y').lo, lim(ec[0], 'y').hi),
  'cada marco vive en UN plano horizontal (span y = 0) (=' + JSON.stringify(lim(ec[0], 'y')) + ')');
ok(close(lim(ec[0], 'x').hi, 196.6) && close(lim(ec[0], 'z').hi, 7.1),
  'y encuadra el plano (x,z): 400 − 2·3 = 394 de largo × 20 − 2·2.5 = 15 de espesor (=' +
  JSON.stringify(lim(ec[0], 'x')) + ' / ' + JSON.stringify(lim(ec[0], 'z')) + ')');
ok(close(ec[0].dims.B, 394) && close(ec[0].dims.A, 15),
  'las dims auto salen del plano correcto: B = 394 (largo útil) · A = 15 (espesor útil) (=' +
  ec[0].dims.B + '/' + ec[0].dims.A + ')');
// El default VIEJO (rumbo x) es el que producía el marco vertical — se deja escrito
// para que el porqué del cambio quede en el test, no sólo en el commit.
const ecViejo = R.expandirComponente({
  tipologia: 'EC', figura: '104D', diam: 8, cara: 'lateral', dims: dimsES,
  distribucion: { modo: 'linear', sep: 50, rango: { eje: 'x', from: -100, to: 100, sep: 50 } }
}, muro);
ok(close(lim(ecViejo[0], 'x').lo, lim(ecViejo[0], 'x').hi) && lim(ecViejo[0], 'y').hi > 100,
  'con la pose vieja (rumbo x) el marco salía VERTICAL (span y = 243) — el bug reportado');

// ===========================================================================
// P6 · FIX 305A — la FIGURA manda el trazado
// ===========================================================================
console.log('\nP6 — 305A colocada con tipología ES:');
ok(FP.familiaDeDibujo('305A', 'estribo') === 'cadena',
  '305A (5 tramos que no cierran) con rol estribo → CADENA, no marco cerrado (=' +
  FP.familiaDeDibujo('305A', 'estribo') + ')');
// 22-AGO · ASSERT CORREGIDO. Antes exigía que la 103E también saliera del constructor
// de marco, y eso congelaba la MITAD del defecto que el fix 305A dejó viva: la rama
// `rol === 'estribo'` de familiaDeDibujo cerraba con un `return 'estribo'` que se comía
// TODA figura de 1–3 lados. MEDIDO sobre las 63 del catálogo con ES/EC/ESC: 17 (101A ·
// 102A/B/C · 103A–L · 201A) se redibujaban como marco cerrado, las 17 con los mismos 35
// puntos y el mismo perímetro de 170.214 cm — una 101A, que es una barra RECTA,
// incluida. Ahora el marco de verdad sigue siendo marco y cada figura abierta se dibuja
// con SUS puntos.
ok(FP.familiaDeDibujo('104D', 'estribo') === 'estribo' && FP.familiaDeDibujo('104D', null) === 'estribo',
  'el marco de verdad (104D) sale del constructor de marco, con rol y sin rol');
ok(FP.familiaDeDibujo('103E', 'estribo') === 'cadena' && FP.familiaDeDibujo('101A', 'estribo') === 'recta',
  'y el EC de 3 lados (103E) y la recta (101A) se dibujan como lo que SON, no como el ' +
  'marco que la tipología les imponía');
// LAS TRES FIGURAS QUE ERAN LA MISMA BARRA. El síntoma exacto que reportó el usuario:
// bajo EC, un 103B, un 103A y un 102A salían idénticos (35 puntos, A=595/C=595/B=245 en
// su muro, 24/52/24 en la viga). Si vuelven a coincidir, es que la tipología volvió a
// pisar la topología.
(function () {
  function firma(fig) {
    const dims = {};
    (CAT.get(fig).parciales || []).forEach(k => { dims[k] = { modo: 'auto' }; });
    const pl = R.expandirComponente({
      tipologia: 'EC', figura: fig, diam: 8, cara: 'lateral', dims: dims,
      distribucion: { modo: 'linear', rango: { eje: 'x', from: 0, to: 0, sep: 50 } }
    }, viga)[0];
    return pl.puntos.length + '#' + JSON.stringify(pl.dims);
  }
  const f = ['103B', '103A', '102A', '101A'].map(firma);
  ok(new Set(f).size === 4,
    'bajo EC, 103B / 103A / 102A / 101A dan CUATRO barras distintas (antes las cuatro ' +
    'eran la misma: 35 puntos y dims A24/B52/C24) (=' + JSON.stringify(f) + ')');
})();
const es305 = R.expandirComponente({
  tipologia: 'ES', figura: '305A', diam: 8, cara: 'lateral',
  dims: {
    A: { modo: 'fija', valor: 24 }, B: { modo: 'fija', valor: 52 }, C: { modo: 'fija', valor: 24 },
    D: { modo: 'fija', valor: 52 }, E: { modo: 'fija', valor: 10 }
  },
  distribucion: { modo: 'linear', rango: { from: -50, to: 50, sep: 50 } }
}, viga);
ok(es305.length === 3 && es305[0].puntos.length === 6,
  'se trazan sus 5 tramos (6 puntos), no los 4 lados de un rectángulo inventado (=' +
  es305[0].puntos.length + ' puntos)');
ok(!es305[0].puntos.some(p => p.esArco),
  'y sin los arcos del gancho sísmico: esta figura no tiene ganchos que dibujar');
// ===========================================================================
// 24-AGO · EL PLANO DE TRABAJO LO MANDA LA POSE, YA NO EL CHIP
// ===========================================================================
// AQUÍ VIVÍA «EL ROL SIGUE MANDANDO lo suyo: la pieza vive en el plano de la SECCIÓN
// (⊥ rumbo)». Ésa era la TERCERA rama por tipología —la que quedaba— escrita como
// aserción: un chip ES/EC/ESC convertía la barra en pieza de sección y le cambiaba
// el plano, el 'auto' y el anidado. MEDIDO en el muro 600×250×20 rec 2.5, φ8, MISMA
// pose {lateral, lado 1, rumbo x}, todo en auto y cambiando SÓLO la etiqueta:
//     103B → B = 595 con MH · B = 11 con EC
//     102A → B = 595 con MH · B = 244 con EC
//     101A → A = 595 con MH · A = 14 con EC
// El dominante era el mismo en las dos columnas; lo que cambiaba era CONTRA QUÉ se
// estiraba. Con la rama fuera (rolDeComponente es topología pura) las dos columnas
// son idénticas: el dominante se estira a lo largo de la cara con la que hizo match
// y los demás 'auto' cruzan por la cara contigua.
// Con esta pose {cara lateral, rumbo x} la 305A corre por la X y sus patas cruzan el
// ESPESOR (z, la normal de su cara): es el mismo plano de trabajo que tendría con
// MH, que es de lo que se trata.
ok(close(lim(es305[0], 'y').lo, lim(es305[0], 'y').hi),
  'la cadena es PLANA en Y: su plano es el de la pose (x = por donde corre · z = la ' +
  'normal de su cara lateral) (=' + JSON.stringify(lim(es305[0], 'y')) + ')');
ok(JSON.stringify(unicos(es305, 'x')) === JSON.stringify([-50, 0, 50]),
  'y el rango la reparte de verdad: 3 piezas en x = −50/0/50 (=' + JSON.stringify(unicos(es305, 'x')) + ')');
// LAS DIMS SIGUEN SIENDO DE CRESTA y el TRAZO va por vértices, así que cada lado
// dibujado mide su dim menos el sobre de su codo. Lo que cambió respecto de la
// versión anterior de este assert es CONTRA QUÉ EJE se mide cada uno:
//   antes (pieza de sección, plano ⊥ rumbo): A → z (ancho) · B → y (alto)
//   ahora (pose: corre en x, cara lateral):  B → x (por donde corre) · A → z (la
//                                            profundidad que cruza)
// Los NÚMEROS de los lados no se movieron —52 − 0.8 y 24 − 0.4—, sólo el eje sobre
// el que caen, que es exactamente lo que la pose declaraba desde el principio.
const sob305 = FP.sobresCresta('305A', 'cabezal', 0.8, null);
ok(close(lim(es305[0], 'x').hi - lim(es305[0], 'x').lo, 52 - (sob305.B || 0)) &&
  close(lim(es305[0], 'z').hi - lim(es305[0], 'z').lo, 24 - (sob305.A || 0)),
  'sus lados miden sus dims menos el sobre de cresta, en los ejes que dice la pose ' +
  '(B a lo largo/X = ' + r3(lim(es305[0], 'x').hi - lim(es305[0], 'x').lo) +
  ' · A en el espesor/Z = ' + r3(lim(es305[0], 'z').hi - lim(es305[0], 'z').lo) + ')');
// GUARDA DE REGRESIÓN del defecto D1 — Y DE LAS REGRESIONES QUE SUS FIXES FUERON
// DESTAPANDO (N1 · N2 · F1 · F2). Con las dims en 'auto' —que es como nace una pieza
// colocada desde el editor— NINGUNA pieza de sección puede salirse del hormigón NI
// del recubrimiento. La versión anterior de esta guarda listaba 8 figuras y sólo 3
// eran cadenas (305A/105A/104B): justo aquellas contra las que se escribió el fix.
// Después entraron las 36 cadenas + los 5 marcos, pero SIEMPRE con n_capas = 1 en
// las dos ramas: por construcción no podía ver el defecto F1 (la pieza de sección
// que se TRASLADA en vez de anidar), que sólo existe de la 2ª capa en adelante.
// Ahora el barrido incluye n_capas ∈ {1, 2, 3} con Sep 3 — donde 15/36 cadenas
// rompían el recubrimiento con 2 capas y 15/36 salían del HORMIGÓN con 3.
//
// EL CRITERIO SE MIDE A LA CARA DEL FIERRO, NO AL EJE (defecto F2). La versión
// anterior comparaba el eje contra el plano LIBRE (z.hi − 12, y.hi − 26) y con eso
// CONGELABA la convención vieja: una cadena de sección resolvía su 'auto' contra la
// luz libre y se dibujaba como EJE, así que pasaba la guarda con φ/2 de fierro
// METIDO en el recubrimiento (φ32: recub real 2.40 lat / 1.40 vert donde el estribo
// vecino daba 3.00 / 4.00). El recubrimiento es una distancia al FIERRO, así que la
// guarda mide donde está el fierro: eje ± φ/2. Con eso las dos piezas de sección
// —la que se dibuja como marco y la que se dibuja como cadena— se miden con la MISMA
// vara, y la que no respete el recub declarado falla.
(function () {
  // 22-AGO · EL BARRIDO PASA A SER EL CATÁLOGO ENTERO. Antes eran «las cadenas» más una
  // lista de 5 marcos escrita a mano, y esa partición dependía de `familiaDeDibujo` con
  // rol — o sea de la misma función que tenía el defecto. Con ella, 17 figuras (101A,
  // 102x, 103x, 201A) quedaban FUERA del barrido justo porque el rol las clasificaba
  // 'estribo' y no estaban en la lista de 5: el hueco se tapaba a sí mismo.
  // Barrer las 63 no necesita saber qué familia es cada una — que es de lo que se trata:
  // ninguna figura colocada como pieza de sección puede sacar fierro del hormigón.
  const SEC = CAT.codigos();
  const MARCO = [];
  const DIST = {
    linear: { modo: 'linear', rango: { eje: 'x', from: -50, to: 50, sep: 50 } },
    'layered×1': { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 3 },
    'layered×2': { modo: 'layered', n_capas: 2, barras_capa: 1, gap: 3 },
    'layered×3': { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 3 }
  };
  const PHI = 8, r = PHI / 10 / 2;      // media barra: del eje a la CARA del fierro
  const fuera = [], marco = [];
  let n = 0;
  SEC.concat(MARCO).forEach(f => {
    Object.keys(DIST).forEach(dk => {
      const dims = {};
      (CAT.get(f).parciales || []).forEach(k => { dims[k] = { modo: 'auto' }; });
      R.expandirComponente({
        tipologia: 'ES', figura: f, diam: PHI, cara: 'lateral', dims: dims,
        distribucion: DIST[dk]
      }, viga).forEach(pl => {
        n++;
        const z = lim(pl, 'z'), y = lim(pl, 'y');
        // hormigón de la viga: z ∈ ±15 · y ∈ ±30 (a la CARA del fierro).
        const sobraH = Math.max(0, z.hi + r - 15, -15 - (z.lo - r),
          y.hi + r - 30, -30 - (y.lo - r));
        // …y el RECUBRIMIENTO declarado (3 lat / 4 vert) es lo que el 'auto'
        // promete: la cara del fierro no puede pasar de z ±12 · y ±26.
        const sobraU = Math.max(0, z.hi + r - 12, -12 - (z.lo - r),
          y.hi + r - 26, -26 - (y.lo - r));
        const et = f + '/' + dk + ' (z=' + JSON.stringify(z) + ' y=' + JSON.stringify(y) + ')';
        if (sobraH > 1e-6) fuera.push(r3(sobraH) + ' cm · ' + et);
        else if (sobraU > 1e-6) marco.push(r3(sobraU) + ' cm · ' + et);
      });
    });
  });
  ok(fuera.length === 0,
    'AUTO: ninguna de las ' + (SEC.length + MARCO.length) + ' figuras de sección saca fierro del HORMIGÓN, ' +
    'con linear y con layered de 1, 2 y 3 capas (' + (fuera.length ? fuera.join(' · ') : n + ' piezas, 0 cm fuera') + ')');
  ok(marco.length === 0,
    '…y ninguna invade el RECUBRIMIENTO: la cara del fierro se queda en el marco que se midió (' +
    (marco.length ? marco.join(' · ') : n + '/' + n + ' dentro del recub') + ')');
})();
// ===========================================================================
// F1 · LAS CAPAS: EL "ANIDADO" DEJA DE SER UNA PREGUNTA (24-ago)
// ===========================================================================
// AQUÍ DECÍA «UNA PIEZA DE SECCIÓN ANIDA, NO SE TRASLADA», y la pieza de sección la
// definía el CHIP. Era la misma rama por tipología de P6, ahora en el eje de las
// capas. Se reemplaza por la consecuencia natural de los datos, que es lo que el
// usuario pidió:
//   · lados en AUTO  → la capa k resuelve su 'auto' contra el marco que dejó la
//     capa k−1: se achica sola, sin que nadie la achique;
//   · lados FIJOS    → no hay nada que achicar: la capa k es la MISMA pieza
//     desplazada la separación, alejándose del borde del que vino.
// LO QUE NO SE MOVIÓ: el CONTORNO CERRADO (104D). No tiene lado que estirar, su
// forma entera la fija el marco de núcleo, y sus tres capas siguen dando el anillo
// concéntrico 25.5 / 22.5 / 19.5 de siempre — mismo número, mismo trazo. Ése es el
// contrato: las cerradas no cambian.
// LA 305A (cadena ABIERTA) sí cambia, y por eso hay que medirlo: ya no finge ser un
// anillo. Se queda en el plano de su pose (plana en y), sus capas entran 3 cm hacia
// el núcleo por la normal de su cara y sus lados 'auto' se achican SOLOS los mismos
// 3 cm por capa (A: 23 → 20 → 17 · C: 24 → 21 → 18 · E: 23 → 20 → 17), así que la
// punta de la pata sigue tocando la cara opuesta en las tres. El dominante B (592) y
// el retorno paralelo D (13) no se mueven: no cruzan la profundidad.
(function () {
  function comp305(fig, gap) {
    const dims = {};
    (CAT.get(fig).parciales || []).forEach(k => { dims[k] = { modo: 'auto' }; });
    return {
      tipologia: 'ES', figura: fig, diam: 10, cara: 'lateral', dims: dims,
      distribucion: { modo: 'layered', n_capas: 3, barras_capa: 1, gap: gap }
    };
  }
  const mrc = R.expandirComponente(comp305('104D', 3), viga).map(pl => lim(pl, 'y'));
  const esperado = [{ lo: -25.5, hi: 25.5 }, { lo: -22.5, hi: 22.5 }, { lo: -19.5, hi: 19.5 }];
  ok(JSON.stringify(mrc) === JSON.stringify(esperado),
    'el CONTORNO CERRADO (104D) sigue dando el anillo concéntrico 25.5/22.5/19.5: una ' +
    'figura cerrada no cambia (=' + JSON.stringify(mrc.map(l => l.hi)) + ')');

  const plsC = R.expandirComponente(comp305('305A', 3), viga);
  const cadZ = plsC.map(pl => lim(pl, 'z')), cadY = plsC.map(pl => lim(pl, 'y'));
  ok(cadY.every(l => close(l.lo, 0) && close(l.hi, 0)),
    'la 305A se queda en el plano de su pose (plana en y) en las 3 capas (=' +
    JSON.stringify(cadY) + ')');
  ok(close(cadZ[0].hi - cadZ[1].hi, 3) && close(cadZ[1].hi - cadZ[2].hi, 3),
    '…y cada capa entra 3 cm hacia el núcleo por la normal de su cara (z.hi = ' +
    JSON.stringify(cadZ.map(l => l.hi)) + ')');
  ok(cadZ.every(l => close(l.lo, cadZ[0].lo)),
    '…mientras su lado en AUTO se achica SOLO lo mismo, así que la punta sigue ' +
    'tocando la cara opuesta (z.lo = ' + JSON.stringify(cadZ.map(l => l.lo)) + ')');
  ok(JSON.stringify(plsC.map(p => p.dims.A)) === JSON.stringify([23, 20, 17]),
    '…lo que en la ficha se lee como A: 23 → 20 → 17 (=' +
    JSON.stringify(plsC.map(p => p.dims.A)) + ')');
  // Y LA CAPA QUE SE QUEDA SIN MARCO NO SE GENERA — la regla de siempre (hallazgo A),
  // ahora también por este camino: con Sep 20 en una viga que da 24 cm útiles de
  // ancho, la capa 2 todavía cabe (A = 3) y la 3 pediría A = −17. Antes ese caso
  // dibujaba las tres y sacaba 31.5 cm de fierro fuera del hormigón.
  const comp = comp305('305A', 20);
  const pocas = R.expandirComponente(comp, viga);
  ok(pocas.length === 2 && (comp._avisos || []).length === 1 &&
    /^Capa 3 no cabe/.test(comp._avisos[0]),
    'con Sep 20 la capa 3 se queda sin marco y se OMITE con aviso (=' +
    pocas.length + ' piezas · ' + JSON.stringify(comp._avisos) + ')');
})();
// F2 · EL RECUBRIMIENTO DECLARADO SE CUMPLE CON CUALQUIER φ. El defecto original: la
// cadena resolvía su 'auto' contra la luz LIBRE y lo dibujaba como EJE, así que su
// cara quedaba φ/2 metida en el recubrimiento y dos piezas vecinas daban recubs
// distintos — la diferencia CRECÍA con el diámetro (φ32: 2.40 donde el estribo daba
// 4.00). El 'auto' tiene que resolver el EJE contra el marco de núcleo (útil − φ).
// 24-AGO · EL EJE QUE SE MIDE ES EL DE LA POSE. Antes se comprobaban las dos
// fronteras del plano de SECCIÓN (3 lateral y 4 vertical), porque el chip ES metía
// la barra en ese plano. Con el rol fuera del chip esta 305A corre por la X pegada a
// su cara LATERAL: la frontera que su 'auto' promete es la del ESPESOR (los 3 cm de
// recub_lat en las dos caras z), y en el eje vertical la pieza es plana —su y la fija
// el reparto de la cara, no un 'auto'—. Lo que el bloque protege es lo mismo: el
// número que el solver promete es el que el trazo deja, con cualquier φ.
(function () {
  const malas = [];
  [8, 16, 25, 32].forEach(phi => {
    const r = phi / 10 / 2;
    const dims = {};
    (CAT.get('305A').parciales || []).forEach(k => { dims[k] = { modo: 'auto' }; });
    const pl = R.expandirComponente({
      tipologia: 'ES', figura: '305A', diam: phi, cara: 'lateral', dims: dims,
      distribucion: { modo: 'linear', rango: { eje: 'x', from: 0, to: 0, sep: 50 } }
    }, viga)[0];
    const rPos = r3(15 - lim(pl, 'z').hi - r), rNeg = r3(15 + lim(pl, 'z').lo - r);
    if (!close(rPos, 3) || !close(rNeg, 3)) malas.push('φ' + phi + ' → ' + rPos + '/' + rNeg);
  });
  ok(malas.length === 0,
    'la cadena deja el recub_lat DECLARADO (3 cm) en las DOS caras del espesor, medido ' +
    'a la cara del fierro y con cualquier φ (' +
    (malas.length ? malas.join(' · ') : 'φ8/16/25/32 exactos') + ')');
})();
// N1 · EL ANCHOR DE UNA PIEZA DE SECCIÓN NO LA CORRE. `_cadenaSeccion` sumaba
// anchor.y/anchor.z como DESPLAZAMIENTOS y son COORDENADAS: con 'layered' el anchor
// trae la Y del marco de cara y la 305A salía dibujada en y ∈ [−0.5, 51.5] — 21.5 cm
// fuera de una viga que llega a y = 30 — mientras la ruta de marco (104D), que
// ignora el anchor, quedaba bien. Las dos distribuciones tienen que dar la MISMA
// pieza: cambia dónde se reparte a lo largo, no la sección.
(function () {
  const dims = {};
  (CAT.get('305A').parciales || []).forEach(k => { dims[k] = { modo: 'auto' }; });
  function pieza(dist) {
    return R.expandirComponente({
      tipologia: 'ES', figura: '305A', diam: 10, cara: 'lateral', dims: JSON.parse(JSON.stringify(dims)),
      distribucion: dist
    }, viga)[0];
  }
  const lay = pieza({ modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 });
  const linn = pieza({ modo: 'linear', rango: { eje: 'x', from: 0, to: 0, sep: 50 } });
  ok(JSON.stringify(lim(lay, 'y')) === JSON.stringify(lim(linn, 'y')) &&
    JSON.stringify(lim(lay, 'z')) === JSON.stringify(lim(linn, 'z')),
    'la 305A en layered y en linear ocupan la MISMA sección (y=' + JSON.stringify(lim(lay, 'y')) +
    ' z=' + JSON.stringify(lim(lay, 'z')) + ')');
  ok(close(centro(lay, 'y'), 0) && close(centro(lay, 'z'), 0),
    '…centrada en su marco de núcleo (con recubs simétricos, el centro es 0/0) (=' +
    centro(lay, 'y') + '/' + centro(lay, 'z') + ')');
  // Y el reparto de una capa coloca CENTROS de pieza, no ejes de barra: dos piezas
  // que ocupan el ancho entero no pueden separarse — caen en el mismo sitio, igual
  // que los dos anillos de un estribo (antes salían 8.4 cm fuera del hormigón).
  const dos = R.expandirComponente({
    tipologia: 'ES', figura: '305A', diam: 10, cara: 'lateral', dims: JSON.parse(JSON.stringify(dims)),
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0 }
  }, viga);
  ok(dos.length === 2 && close(centro(dos[0], 'z'), centro(dos[1], 'z')) &&
    lim(dos[1], 'z').hi <= 12 + 1e-6,
    'barras_capa=2 sobre una cadena que ocupa el ancho: las dos quedan en el marco (z=' +
    JSON.stringify(lim(dos[1], 'z')) + ')');
})();
// N2 · MEDIR = DIBUJAR, EXACTO — AHORA SOBRE EL SOLVER QUE QUEDA (24-ago)
// ---------------------------------------------------------------------------
// El bloque original comparaba `autosCadenaSeccion` (lo que el motor RESUELVE) con
// `extensionCadenaSeccion` (lo que el trazador DIBUJA) para las 36 cadenas: el
// defecto era que el solver aproximaba la reserva de los quiebres con una recta de
// dos puntos sobre una extensión lineal A TROZOS, y 16 de 36 rompían el marco útil
// (la 104C resolvía u = 24 y dibujaba 29.30; la 105I, 42.70).
// Esas tres funciones vivían en el plano de la SECCIÓN, al que sólo se llegaba por el
// chip ES/EC/ESC, y se fueron con la rama. El contrato NO se va: el solver vivo es
// `autoProfundidadLong` —el lado 'v' de cualquier figura con dominante, medido contra
// la profundidad útil de su pose— y se comprueba igual, sólo que de punta a punta:
// se expande la figura con TODO en auto y se mide lo que el trazo ocupa sobre la
// normal de su cara contra lo que el marco promete.
// MEDIDO al escribirlo (viga 600×60×30 rec 3 lat, φ8 → útil eje a eje 24 − 0.8 =
// 23.2): de las 40 figuras abiertas con lado 'v', NINGUNA se pasa, y la que menos
// aprovecha se queda 0.6 cm corta — que es el redondeo al centímetro hacia abajo, el
// único hueco permitido (redondear hacia arriba metería la barra en el recub).
(function () {
  const PHI = 8, phi = PHI / 10, utilV = (30 - 2 * 3) - phi;   // 23.2
  const abiertas = CAT.codigos().filter(f =>
    FP.familiaDeDibujo(f) !== 'estribo' && FP.tramosDeFigura(f));
  const pasan = [], cortas = [];
  let conV = 0;
  abiertas.forEach(f => {
    const ejes = FP.ejesCadenaLong(f);
    if (!ejes || !Object.keys(ejes).some(k => ejes[k] === 'v')) return;
    conV++;
    const dims = {};
    (CAT.get(f).parciales || []).forEach(k => { dims[k] = { modo: 'auto' }; });
    const pl = R.expandirComponente({
      tipologia: 'MH', figura: f, diam: PHI, cara: 'lateral',
      pose: { cara: 'lateral', lado: 1, rumbo: 'x' }, dims: dims,
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
    }, viga)[0];
    const zs = pl.puntos.map(p => p.z);
    const span = Math.max(...zs) - Math.min(...zs);
    if (span > utilV + 1e-9) pasan.push(f + ' ocupa ' + r3(span) + ' de ' + utilV);
    if (span < utilV - 1) cortas.push(f + ' ocupa ' + r3(span) + ' de ' + utilV);
  });
  ok(conV === 40, 'el barrido es de verdad: 40 figuras abiertas tienen un lado que ' +
    'cruza la profundidad (=' + conV + ')');
  ok(pasan.length === 0,
    'el AUTO de la profundidad NUNCA se pasa del marco útil (' +
    (pasan.length ? pasan.slice(0, 4).join(' · ') : conV + '/' + conV + ' dentro de ' + utilV) + ')');
  ok(cortas.length === 0,
    '…y tampoco se queda corto más allá del redondeo al centímetro (' +
    (cortas.length ? cortas.slice(0, 4).join(' · ') : 'holgura máxima 0.6 cm') + ')');
})();
// ===========================================================================
// LA CAPA DE LADOS FIJOS SE DESPLAZA — Y NO SE ACHICA (24-ago)
// ===========================================================================
// Este bloque ha cambiado de assert dos veces y conviene dejar por qué la de hoy no
// es otra vuelta más:
//   · hasta el 22-ago pedía que la 2ª capa se CORRIERA 3 cm en z. Con la 305A
//     tratada como pieza de sección eso era el defecto F1 (la pieza que se traslada
//     por la normal en vez de anidar): 32 cadenas sacaban de 1.6 a 3.8 cm de fierro
//     fuera del hormigón, sin un aviso.
//   · del 22 al 23-ago pidió el ANILLO CONCÉNTRICO. Correcto mientras el chip ES
//     convirtiera la barra en pieza de sección.
//   · hoy el chip no convierte nada y esta 305A es una cadena abierta que corre por
//     la X. Sus cinco dims están FIJAS —las escribió el usuario—, así que no hay
//     nada que achicar y la regla es la que el usuario dictó para el estribo de
//     confinamiento: «una segunda capa debiera generar un elemento exactamente
//     igual pero desplazado en la distancia de separación en dirección contraria al
//     borde del que viene».
// Y NO ES EL DEFECTO F1 OTRA VEZ, aunque el movimiento se parezca: entonces la pieza
// se trasladaba MINTIENDO —su 'auto' estaba resuelto contra el marco de la capa 1 y
// nadie lo re-resolvía—, y ahora el 'auto' se re-resuelve capa a capa (bloque F1
// arriba: A 23 → 20 → 17) y la capa que se queda sin marco se OMITE con aviso. Lo
// que se traslada aquí es una pieza de medidas FIJAS, que es el único caso en que
// trasladar es la respuesta correcta. El barrido de abajo lo vigila: 0 cm fuera.
const arr305 = R.expandirComponente({
  tipologia: 'ES', figura: '305A', diam: 8, cara: 'lateral',
  dims: {
    A: { modo: 'fija', valor: 24 }, B: { modo: 'fija', valor: 52 }, C: { modo: 'fija', valor: 24 },
    D: { modo: 'fija', valor: 52 }, E: { modo: 'fija', valor: 10 }
  },
  distribucion: { modo: 'arreglo', n_capas: 2, sep_capas: 3, eje_capas: 'z', rango: { eje: 'x', from: -50, to: 50, sep: 50 } }
}, viga);
(function () {
  const c1 = lim(arr305[0], 'z'), c2 = lim(arr305[arr305.length - 1], 'z');
  ok(arr305.length === 6 && close(c1.hi - c1.lo, c2.hi - c2.lo),
    'en arreglo, la 2ª capa es EXACTAMENTE la misma pieza: mismo ancho en z (' +
    r3(c1.hi - c1.lo) + ' vs ' + r3(c2.hi - c2.lo) + ')');
  ok(close(c1.hi - c2.hi, 3) && close(c1.lo - c2.lo, 3),
    '…DESPLAZADA los 3 cm del Sep, alejándose del borde del que viene (z ' +
    JSON.stringify(c1) + ' → ' + JSON.stringify(c2) + ')');
  ok(JSON.stringify(arr305[0].dims) === JSON.stringify(arr305[arr305.length - 1].dims),
    '…y con las MISMAS dims: lo que el usuario fijó no se achica (=' +
    JSON.stringify(arr305[arr305.length - 1].dims) + ')');
})();
// Y el barrido que lo vigila: ninguna figura del catálogo, en ARREGLO de 3 capas @3,
// puede sacar fierro del hormigón. Es la misma guarda que arriba para linear/layered,
// en el distribuidor que se había quedado fuera.
(function () {
  const fuera = [];
  let n = 0;
  CAT.codigos().forEach(f => {
    const dims = {};
    (CAT.get(f).parciales || []).forEach(k => { dims[k] = { modo: 'auto' }; });
    R.expandirComponente({
      tipologia: 'ES', figura: f, diam: 8, cara: 'lateral', dims: dims,
      distribucion: { modo: 'arreglo', n_capas: 3, sep_capas: 3, eje_capas: 'z',
        rango: { eje: 'x', from: -50, to: 50, sep: 50 } }
    }, viga).forEach(pl => {
      n++;
      const z = lim(pl, 'z'), y = lim(pl, 'y'), r = 0.4;
      const sobra = Math.max(0, z.hi + r - 15, -15 - (z.lo - r), y.hi + r - 30, -30 - (y.lo - r));
      if (sobra > 1e-6) fuera.push(r3(sobra) + ' cm · ' + f);
    });
  });
  ok(fuera.length === 0,
    'ARREGLO ×3 @3: ninguna de las 63 figuras saca fierro del hormigón (' +
    (fuera.length ? fuera.slice(0, 6).join(' · ') : n + ' piezas, 0 cm fuera') + ')');
})();
// Y el payload sigue llevando las 5 dims (lo que el backend pesa).
(function () {
  const out = G.generarViga({
    tipo: 'viga', geometria: { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
    componentes: [{
      comp_id: 'ES', tipologia: 'ES', figura: '305A', diam: 8, cara: 'lateral',
      dims: {
        A: { modo: 'fija', valor: 24 }, B: { modo: 'fija', valor: 52 }, C: { modo: 'fija', valor: 24 },
        D: { modo: 'fija', valor: 52 }, E: { modo: 'fija', valor: 10 }
      },
      distribucion: { modo: 'linear', rango: { from: -50, to: 50, sep: 50 } }
    }]
  }, {});
  const b = out.barras[0];
  ok(out.resumen.barras === 3 && b.dim_a === 24 && b.dim_e === 10 && b.dim_f == null,
    'payload: la 305A llena dim_a..dim_e y nada más (pasa validar_geometria)');
})();

// ===========================================================================
// P7 · LADO DOMINANTE — cascada determinista
// ===========================================================================
console.log('\nP7 — lado dominante: catálogo → B → 1er parcial (el "mayor" desaparece):');
// Figura donde el MAYOR NO es B: 104B con D = 200 y B = 40.
const dimsMayorD = { A: 30, B: 40, C: 30, D: 200 };
ok(FP.familiaDeDibujo('104B', null) === 'cadena', '104B es cadena (4 lados con quiebres de 45°)');
ok(FP.ladoLongitudinalCadena('104B', dimsMayorD) === 'B',
  'con A30/B40/C30/D200 el lado longitudinal es B — ANTES era D (el mayor medido) (=' +
  FP.ladoLongitudinalCadena('104B', dimsMayorD) + ')');
ok(FP.ladoDominanteFigura('104B') === 'B' && R.ladoDominante({ figura: '104B', dims: dimsMayorD }) === 'B',
  'motor y trazador responden LO MISMO (fuente única): reglas.ladoDominante = B');
// POR QUÉ IMPORTA: con el criterio viejo, subir D por encima de B movía en silencio
// la dim que el auto estira y la que recibe el empalme. Ahora es una propiedad de la
// FIGURA y no de sus medidas → estable mientras el usuario edita.
ok(FP.ladoLongitudinalCadena('104B', { A: 30, B: 592, C: 30, D: 40 }) === 'B' &&
  FP.ladoLongitudinalCadena('104B', { A: 300, B: 10, C: 30, D: 40 }) === 'B',
  'y NO cambia al editar las patas: B sigue siendo el dominante con cualquier medida');
// 1º de la cascada: si el catálogo declara `lado_dominante`, MANDA (es el campo que
// va a poblar el Diseñador de figuras).
(function () {
  const spec = CAT.get('104B');
  const antes = spec.lado_dominante;
  spec.lado_dominante = 'D';
  ok(FP.ladoLongitudinalCadena('104B', dimsMayorD) === 'D',
    'spec.lado_dominante = D → manda sobre la convención B (1º de la cascada)');
  spec.lado_dominante = 'Z';   // letra que la figura NO tiene
  ok(FP.ladoLongitudinalCadena('104B', dimsMayorD) === 'B',
    'un lado_dominante que la figura no declara se IGNORA (no se inventa un parcial)');
  if (antes === undefined) delete spec.lado_dominante; else spec.lado_dominante = antes;
  ok(FP.ladoLongitudinalCadena('104B', dimsMayorD) === 'B', 'restaurado: vuelve a B');
})();
// 3º de la cascada: figura sin B → el primer parcial. (201A: parciales B/G/H, tiene
// B; se usa una serie sin B: la 305A sí tiene B, así que se prueba con un spec ad hoc.)
(function () {
  const cod = '__TESTGH__';
  CAT.FIGURAS[cod] = { codigo: cod, parciales: ['G', 'H', 'I', 'J'], angulos: [], radio: false, geometria: null };
  ok(FP.ladoDominanteFigura(cod) === 'G',
    'figura sin parcial B → el PRIMER parcial (=' + FP.ladoDominanteFigura(cod) + ')');
  delete CAT.FIGURAS[cod];
})();
// Cadena CERRADA: no hay lado que estirar (como el estribo) → null.
ok(FP.ladoLongitudinalCadena('104A', { A: 20, B: 50, C: 20, D: 50 }) === undefined ||
  FP.ladoLongitudinalCadena('104A', { A: 20, B: 50, C: 20, D: 50 }) === null,
  'un marco cerrado no declara lado longitudinal (no se estira ni se empalma)');

// ===========================================================================
// P8 · VIGA-SEMILLA INTACTA
// ===========================================================================
console.log('\nP8 — la viga-semilla: poses intactas, kg re-derivado:');
// Ninguno de los cambios de POSE de este archivo toca la semilla (sus 4
// 18-AGO · 136.1 -> 140.1 kg (CONVENCION DE VERTICE, cerrada por el usuario). El
// numero del catalogo pasa a leerse como ANGULO DEL VERTICE (el que queda entre los
// dos tramos de fierro) y no como recorrido del doblado. Consecuencia en la semilla:
// las patas de 45 del CBS 103B quedan REPLEGADAS sobre el cuerpo en vez de abiertas,
// asi que ya no le roban largo al tramo B: su 'auto' sube de 547.974 a 590.4 (la
// unica reserva por punta que queda es la cresta del codo, phi/2 = 0.8). Son 42.426
// cm mas por barra x 6 barras phi16 = 4.0 kg. Items, barras y las otras 3 figuras del
// listado (2 x 101A y el estribo 104D) no se mueven ni un gramo.
// --- HISTORIA PREVIA (12-ago), ya superada por la nota de arriba: ---
// componentes son 'acostada'). Los kg bajan 140.2 → 136.1 por la MIGRACIÓN
// CABEZAL → TRAZADOR: el CBS es una 103B con dobleces de 45°/45° declarados en el
// catálogo, y al honrarlos el auto-largo reserva 30·cos45 + φ/2 = 22.0132 por
// punta → B = 592 − 44.0264 = 547.974.
const sem = G.generarViga(SEM.semillaViga(), {});
// 20-AGO · 140.1 -> 140.2 kg (MEDIDA HASTA LA CRESTA, decision del usuario). Un lado
// ya no se mide a VERTICE: es una medida recta que suma R + phi por cada doblez que lo
// cierra (lado = tramo recto + R + phi). El unico numero de la semilla que se mueve es
// el B del CBS 103B phi16: 590.4 -> 592.0, que es la luz util exacta de la viga
// (600 - 2*4); esos 1.6 cm x 6 barras phi16 pesan 0.1 kg. Las patas 30/30 son FIJAS:
// las escribio el usuario y ni la cresta ni el redondeo las tocan.
ok(sem.resumen.items === 4 && sem.resumen.barras === 72 && close(sem.resumen.kg, 140.2, 0.05),
  'semilla = {items:4, barras:72, kg:140.2} (=' + JSON.stringify(sem.resumen) + ')');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — modelo de POSE (24 orientaciones + espejo) pasa.');
