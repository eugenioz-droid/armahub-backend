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
//   P8 · VIGA-SEMILLA (72 barras / 4 ítems; 136.1 kg tras migrar el cabezal al
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
  const RESERVA_CBS = 30 * Math.SQRT1_2 + 1.6 / 2;   // 22.013203 por punta
  ok(cbs.n === 6 && close(cbs.x.lo, r3(295.2 - 30 * Math.SQRT1_2)) && close(cbs.x.hi, 295.2) &&
    close(JSON.parse(cbs.dims).B, 52 - 2 * RESERVA_CBS) &&
    JSON.parse(cbs.dims).A === 30 && JSON.parse(cbs.dims).C === 30,
    'CBS 103B sup+de_pie: pegada al testero +X (x.hi 295.2, punta 273.987) · 6 barras · patas 30/30 y B = 52 − 2·22.0132 = 7.974 (=' +
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
  // otro extremo no dobla contra nada— y B pasa de 592 a 591.2. La cadena se centra
  // por BBOX (convención ya vigente para todo el trazador), así que esos 0.8 se
  // reparten 0.4 y 0.4: ±295.6. Lo que el assert protege —que la MEDIA VUELTA
  // existe y lleva la pata de un testero al otro— es exactamente lo mismo.
  ok(vistos.size === 4 && patas[1] === '295.6/0',
    'girando en torno a su normal la 102A pasa por 4 barras distintas y la MEDIA VUELTA ' +
    'lleva la pata de x=−295.6 a x=+295.6 (=' + patas.join(' · ') + ')');
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
ok(close(g0.dims.A, 589.2) && close(lim(g0, 'y').hi, 23.2),
  'sup/x: A = 600 − 2·(4 + pila ext 1.4) = 589.2 · y = 23.2 (pila SUP) (=' + g0.dims.A + '/' + lim(g0, 'y').hi + ')');
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
// ±296 → ±295.6 por la migración cabezal → trazador: la 102A reserva φ/2 = 0.8 en
// su ÚNICO extremo con doblez (la cresta del codo al recub) y el centrado por bbox
// reparte esa reserva a los dos lados. El espejo, que es lo que se mide acá, no
// cambia: la pata sigue saltando de un testero al otro.
ok(close(n102.puntos[0].x, -295.6) && close(e102.puntos[0].x, 295.6),
  '102A: la pata pasa del extremo −X al +X (=' + r3(n102.puntos[0].x) + ' → ' + r3(e102.puntos[0].x) + ')');
ok(JSON.stringify(n102.dims) === JSON.stringify(e102.dims),
  'y las dims NO cambian: es la MISMA barra (=' + JSON.stringify(e102.dims) + ')');
ok(close(lim(n102, 'x').lo, lim(e102, 'x').lo) && close(lim(n102, 'x').hi, lim(e102, 'x').hi) &&
  close(lim(n102, 'y').lo, lim(e102, 'y').lo) && close(lim(n102, 'y').hi, lim(e102, 'y').hi),
  'tampoco se MUEVE: el bbox es el mismo (la reflexión es sobre su propio plano medio)');
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
// FEEDBACK 13-ago: la pose vieja {extremo, rumbo z} era IMPOSIBLE — el plano de
// una pieza de sección es ⊥ a su rumbo, así que rumbo z dejaba el plano ⊥ al
// espesor que la traba debe CRUZAR (TC 104B resolvía 244×4 y se dibujaba plana).
// Cuerpo en el espesor ⇒ el plano CONTIENE z ⇒ rumbo y: la MISMA sección
// horizontal del EC al que acompaña, repartida en la altura.
ok(R.poseDefault('muro', 'TR').cara === 'lateral' && R.poseDefault('muro', 'TR').rumbo === 'y',
  'MURO/TR: cose las caras z± en la sección horizontal del EC (lateral, rumbo y)');
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
ok(FP.familiaDeDibujo('104D', 'estribo') === 'estribo' && FP.familiaDeDibujo('103E', 'estribo') === 'estribo',
  'el marco de verdad (104D) y el EC de 3 lados del catálogo (103E) siguen saliendo del constructor de marco');
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
// EL ROL SIGUE MANDANDO lo suyo: la pieza vive en el plano de la SECCIÓN (⊥ rumbo)
// y se reparte a lo largo, como cualquier estribo.
ok(close(lim(es305[0], 'x').lo, lim(es305[0], 'x').hi),
  'la cadena se traza EN LA SECCIÓN (un solo plano X), que es el plano ⊥ al rumbo');
ok(JSON.stringify(unicos(es305, 'x')) === JSON.stringify([-50, 0, 50]),
  'y el reparto lineal es el del rol estribo (3 piezas @50) (=' + JSON.stringify(unicos(es305, 'x')) + ')');
// SIN TRANSPONER (defecto D1 del verificador). La cadena se traza en su frame
// NATIVO: el primer tramo (A) corre en +u = Z = el ANCHO de la viga, y el
// siguiente (B, tras el giro de 90°) en +v = Y = el ALTO. Es la misma lectura con
// la que el 'auto' del rol estribo mide (A/C contra el ancho útil, B/D contra el
// alto útil), y por eso las dos coinciden.
// La versión anterior de este test asertaba lo CONTRARIO (B = 52 a lo ancho) y
// congelaba el bug: en una viga de 30 de ancho eso son 11 cm de fierro FUERA del
// hormigón, con el test en verde.
ok(close(lim(es305[0], 'z').hi - lim(es305[0], 'z').lo, 24) &&
  close(lim(es305[0], 'y').hi - lim(es305[0], 'y').lo, 52),
  'sus lados miden lo que dicen las dims SIN TRANSPONER (A = 24 a lo ancho/Z · B = 52 de alto/Y) (=' +
  r3(lim(es305[0], 'z').hi - lim(es305[0], 'z').lo) + ' × ' +
  r3(lim(es305[0], 'y').hi - lim(es305[0], 'y').lo) + ')');
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
  const SEC = CAT.codigos().filter(f => FP.familiaDeDibujo(f, 'estribo') === 'cadena');
  const MARCO = ['103E', '103H', '104D', '104O', '104P'];
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
// F1 · UNA PIEZA DE SECCIÓN ANIDA, NO SE TRASLADA. El anidado lo decidía
// `_dibujaMarcoCerrado` ("¿se dibuja como marco cerrado?") y una CADENA de sección
// contestaba "no": sus dims quedaban idénticas capa a capa y el k·gap entero se iba
// a la POSICIÓN, o sea la pieza se corría por la NORMAL. Medido en la viga con una
// 305A φ10 y Sep 3: capa 2 en y[−29, 23] (3 cm dentro del recub) y capa 3 en
// y[−32, 20] — 2 cm FUERA del hormigón, con avisos = [].
// La referencia de lo correcto estaba viva al lado: la 104D, que se dibuja como
// marco, anidaba bien. Las dos son la misma clase de pieza (encuadran la sección) y
// ahora las dos dan el MISMO anillo concéntrico.
(function () {
  function capas(fig) {
    const dims = {};
    (CAT.get(fig).parciales || []).forEach(k => { dims[k] = { modo: 'auto' }; });
    return R.expandirComponente({
      tipologia: 'ES', figura: fig, diam: 10, cara: 'lateral', dims: dims,
      distribucion: { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 3 }
    }, viga).map(pl => lim(pl, 'y'));
  }
  const cad = capas('305A'), mrc = capas('104D');
  const esperado = [{ lo: -25.5, hi: 25.5 }, { lo: -22.5, hi: 22.5 }, { lo: -19.5, hi: 19.5 }];
  ok(JSON.stringify(cad) === JSON.stringify(esperado),
    '305A con 3 capas @3: anillos CONCÉNTRICOS 25.5/22.5/19.5, no una pila que se ' +
    'corre (=' + JSON.stringify(cad.map(l => l.hi)) + ')');
  ok(JSON.stringify(cad) === JSON.stringify(mrc),
    '…exactamente lo mismo que la 104D, que se dibuja como marco: la FORMA cambia el ' +
    'trazo, no el anidado (=' + JSON.stringify(mrc.map(l => l.hi)) + ')');
  // Y la capa que ya no cabe se OMITE CON AVISO (no se dibuja fuera ni se manda con
  // dims imposibles) — el mismo mecanismo que la cerrada, por el mismo camino.
  const comp = {
    tipologia: 'ES', figura: '305A', diam: 10, cara: 'lateral',
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' }, E: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 20 }
  };
  const pocas = R.expandirComponente(comp, viga);
  ok(pocas.length === 1 && (comp._avisos || []).length === 2,
    'con Sep 20 sólo cabe la 1ª capa: las otras dos se omiten CON aviso (=' +
    pocas.length + ' pieza · ' + JSON.stringify(comp._avisos) + ')');
})();
// F2 · UN SOLO RECUBRIMIENTO PARA LAS DOS PIEZAS DE SECCIÓN. La cadena resolvía su
// 'auto' contra la luz LIBRE y lo dibujaba como EJE; el estribo descuenta φ/2 vía
// _marcoNucleo. Dos piezas vecinas quedaban con recubrimientos distintos, y la
// diferencia CRECÍA con el diámetro (φ32: 2.40 vs 4.00 vertical).
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
    const rLat = r3(15 - lim(pl, 'z').hi - r), rVert = r3(30 - lim(pl, 'y').hi - r);
    if (!close(rLat, 3) || !close(rVert, 4)) malas.push('φ' + phi + ' → ' + rLat + '/' + rVert);
  });
  ok(malas.length === 0,
    'la cadena de sección deja el recub DECLARADO (3 lat / 4 vert) medido a la cara ' +
    'del fierro, con cualquier φ (' + (malas.length ? malas.join(' · ') : 'φ8/16/25/32 exactos') + ')');
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
// N2 · MEDIR = DIBUJAR, EXACTO. El 'auto' de una cadena de sección resolvía la
// reserva de los quiebres con una RECTA DE DOS PUNTOS sobre una extensión que es
// lineal A TROZOS: la 104C resolvía u = 24 y dibujaba 29.30, la 105I 42.70, la 106A
// 48.00 (el doble del marco) y la 105C fallaba además en v. 16 de las 36 cadenas
// rompían el marco útil por eso. Acá se compara, figura por figura, lo que el motor
// RESUELVE contra lo que el trazador DIBUJA.
(function () {
  const SEC = CAT.codigos().filter(f => FP.familiaDeDibujo(f, 'estribo') === 'cadena');
  // Un útil cualquiera: lo que se verifica es el CONTRATO de la función (resolver
  // = dibujar), no de dónde sale el número. Quien lo llama de verdad (reglas
  // ._dimsEfectivas) le pasa el marco de núcleo EJE A EJE —anchoUtil − φ por
  // altoUtil − φ, ver defecto F2—, no la luz libre.
  const util = { u: 24, v: 52 };
  const gancho = FP.extGancho(0.8);         // φ8 → 7.5 (6φ mín 7.5)
  const malas = [];
  SEC.forEach(f => {
    const ejes = FP.ejesCadenaSeccion(f, 'estribo');
    const base = {};
    Object.keys(ejes).forEach(k => { if (ejes[k] === 'd') base[k] = gancho; });
    // TANDA V: el diámetro viaja también al solver — el 'auto' hace caber el
    // trazo CON sus ganchos de radio, que es el que la extensión mide y el que
    // se dibuja. Sin él, el solver modelaba la cadena de vértices y "resolver =
    // dibujar" se rompía por un radio entero en las figuras con gancho >90°.
    const t = FP.autosCadenaSeccion(f, base, ejes, util, 0.8);
    const dims = {};
    Object.keys(ejes).forEach(k => { dims[k] = (ejes[k] === 'd') ? gancho : t[ejes[k]]; });
    const ext = FP.extensionCadenaSeccion(f, dims, 0.8);
    ['u', 'v'].forEach(e => {
      if (!Object.keys(ejes).some(k => ejes[k] === e)) return;   // sin lados auto en ese eje
      if (Math.abs(ext[e] - util[e]) > 1e-6) {
        malas.push(f + '·' + e + ' resuelve ' + r3(t[e]) + ' y dibuja ' + r3(ext[e]) + ' (útil ' + util[e] + ')');
      }
    });
  });
  ok(malas.length === 0,
    'el AUTO de las ' + SEC.length + ' cadenas de sección dibuja EXACTAMENTE el marco útil (' +
    (malas.length ? malas.slice(0, 4).join(' · ') + (malas.length > 4 ? ' · +' + (malas.length - 4) : '') : SEC.length + '/' + SEC.length + ' exactas') + ')');
})();
// El anidado también sigue al DIBUJO: una cadena abierta no anida como anillo
// concéntrico, así que sus capas se separan con Sep (y no se quedan encimadas).
const arr305 = R.expandirComponente({
  tipologia: 'ES', figura: '305A', diam: 8, cara: 'lateral',
  dims: {
    A: { modo: 'fija', valor: 24 }, B: { modo: 'fija', valor: 52 }, C: { modo: 'fija', valor: 24 },
    D: { modo: 'fija', valor: 52 }, E: { modo: 'fija', valor: 10 }
  },
  distribucion: { modo: 'arreglo', n_capas: 2, sep_capas: 3, eje_capas: 'z', rango: { eje: 'x', from: -50, to: 50, sep: 50 } }
}, viga);
ok(arr305.length === 6 && close(centro(arr305[arr305.length - 1], 'z') - centro(arr305[0], 'z'), 3),
  'en arreglo, la 2ª capa se separa los 3 cm del campo Sep (no queda encimada) (=' +
  r3(centro(arr305[arr305.length - 1], 'z') - centro(arr305[0], 'z')) + ')');
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
// componentes son 'acostada'). Los kg bajan 140.2 → 136.1 por la MIGRACIÓN
// CABEZAL → TRAZADOR: el CBS es una 103B con dobleces de 45°/45° declarados en el
// catálogo, y al honrarlos el auto-largo reserva 30·cos45 + φ/2 = 22.0132 por
// punta → B = 592 − 44.0264 = 547.974.
const sem = G.generarViga(SEM.semillaViga(), {});
ok(sem.resumen.items === 4 && sem.resumen.barras === 72 && close(sem.resumen.kg, 136.1, 0.05),
  'semilla = {items:4, barras:72, kg:136.1} (=' + JSON.stringify(sem.resumen) + ')');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — modelo de POSE (24 orientaciones + espejo) pasa.');
