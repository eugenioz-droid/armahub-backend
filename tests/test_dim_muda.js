// =============================================================================
// MEDIR = DIBUJAR, PARA LA DIMENSIÓN — test headless (Node)
// =============================================================================
// El motor ya tenía cerrado el simétrico de esto para el ÁNGULO: `trazoLeeAngulos`
// declara en qué figuras el control mueve el dibujo, y reglas emite «el ángulo
// viaja al despiece pero NO mueve el trazo 3D» cuando no. Para la DIMENSIÓN ese
// simétrico NO EXISTÍA, y el agujero se medía así (barrido de las 63 figuras del
// catálogo × todos sus lados × roles ES/CBS, Δ +5 en cada uno = 518 casos con
// efecto sobre el corte):
//
//        ANTES        456 coherentes · 0 desiguales · 62 MUDAS · 0 avisos
//        AHORA        472 coherentes · 0 desiguales · 46 MUDAS · 46 avisos
//
// "MUDA" = el largo de corte sube 5.00 cm, los kg suben con él y la polilínea 3D
// no se mueve 0.000. Las 62 eran de dos clases distintas y por eso hay dos fixes:
//
//   1) EL GANCHO DECLARADO (16 casos: 106A/B/C/D × lados A y F × roles ES y CBS).
//      El estribo con ganchos declarados lista dim A = dim F = extGancho() y
//      dibujaba la pata con esa misma constante recalculada DENTRO de
//      `_estriboPerimetral`. Coincidían mientras nadie las tocara. MEDIDO en la
//      106A rol estribo φ8: dim_a 7.5 → 12.5, largo 167 → 172, kg 138.8 → 139.8 y
//      el perímetro dibujado 169.213659 → 169.213659, o sea 0.000000. Ahora la
//      pata declarada llega al trazador por `anchor.ganchoDim` y el dibujo crece
//      exactamente lo mismo que el corte. NO SE ARREGLÓ CON UN AVISO: acá el 3D
//      SÍ puede decir la verdad, y la clase de fix correcta es que la diga.
//
//   2) LA FIGURA QUE NO SE DIBUJA DE SUS DIMS (46 casos: 101A, 102x, 103x y 201A
//      con rol ES). Una figura ABIERTA con rol de sección cae en el constructor
//      de MARCO, que traza el rectángulo del hormigón y no mira las dims — ahí NO
//      hay número que corregir: la dim, el largo y los kg son correctos (es lo
//      que se corta) y el que miente es el 3D. Divergencia PREEXISTENTE, la misma
//      antes y después de la tanda Δ: una 103B-ES con dims FIJAS 80/80/80 dibuja
//      el mismo perímetro que con las auto 24/52/24. Lo que faltaba era decirlo, y
//      eso es lo que ahora hace `_avisarDimsMudas`.
//
// QUÉ PROTEGE, en orden:
//   A. CERO REGRESIÓN: la viga-semilla en {items:4, barras:72, kg:140.1} con sus
//      dims exactas, y el trazo de una 106A sin Δ clavado en su perímetro de
//      siempre (la pata declarada sólo viaja cuando el usuario la escribe).
//   B. Δ EN UN GANCHO: el trazo crece EXACTAMENTE lo que crece el corte, en las 4
//      figuras 106x, por los dos ganchos y en los dos roles.
//   C. SIN CLAMP: un Δ que saca el gancho del hormigón se dibuja igual y lo dice
//      el aviso de siempre — no se recorta la pata para que quepa.
//   D. Δ EN UN LADO MUDO: la dim y los kg suben (dato correcto) y sale el aviso.
//   E. DIM FIJA sobre un lado del marco: también avisa (el marco lo fija el
//      hormigón), y el Δ sobre ese mismo lado NO avisa porque sí lo mueve.
//   F. EL BARRIDO COMPLETO: en las 63 figuras del catálogo no queda ni UN caso en
//      que el corte suba sin que el trazo se mueva o el motor lo avise.
//
// Correr con: node tests/test_dim_muda.js

'use strict';
const path = require('path');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

const CAT = require(path.join(BASE, 'catalogo_figuras.js'));
const FP = require(path.join(BASE, 'figura_puntos.js'));
const R = require(path.join(BASE, 'reglas.js'));
const G = require(path.join(BASE, 'generar.js'));
const S = require(path.join(BASE, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function casi(a, b, tol, m) { ok(Math.abs(Number(a) - Number(b)) <= tol, m + ' (' + a + ' vs ' + b + ')'); }

const HOST = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// Componente con TODAS las dims en 'auto' — el caso donde el motor decide y donde
// una divergencia entre lo que mide y lo que dibuja no la tapa ningún número
// escrito a mano.
function comp(fig, tip, mut) {
  const sp = CAT.get(fig) || {};
  const dims = {};
  (sp.parciales || []).forEach(p => { dims[p] = { modo: 'auto' }; });
  const esSeccion = (tip === 'ES' || tip === 'TRV');
  const c = {
    comp_id: 'X', jerarquia: esSeccion ? 1 : 2,
    tipologia: tip, figura: fig, diam: esSeccion ? 8 : 16, suf_tipo: '',
    cara: esSeccion ? 'lateral' : 'sup',
    recub_override: null, angulos: [], prioridad: null, empalme: null, depende_de: null,
    modo: esSeccion ? 'lineal' : 'puntual', plano_pieza: { volteado: false },
    arreglo: { n_capas: 1, sep_capas: 20, rango: null },
    dims: dims,
    distribucion: esSeccion
      ? { modo: 'linear', zonas: [{ long: 600, sep: 200 }], start_offset: 4 }
      : { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  };
  if (mut) mut(c);
  return c;
}
// Largo DIBUJADO de la polilínea (lo que el 3D muestra) — la otra mitad de la
// comparación: enfrente va la suma de las dims, que es lo que se corta.
function perimetro(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  }
  return s;
}
function sumaDims(d) { let s = 0; for (const k in d) if (d[k] != null) s += Number(d[k]); return s; }
function avisosDe(c) { return c._avisos || []; }
// Los avisos de "fierro fuera del hormigón" y de reparto NO cuentan como respuesta
// a este problema: hablan de OTRA cosa (la barra no cabe), y una receta puede
// dispararlos con el trazo perfectamente sincronizado con sus dims.
function avisosDelTrazo(c) {
  return avisosDe(c).filter(a => /trazo 3D|sale del marco/.test(a));
}

// ==================================================== A · CERO REGRESIÓN
console.log('A — sin dims escritas a mano, el motor da EXACTAMENTE lo de siempre');
{
  const res = G.generarViga(S.semillaViga(), {});
  // 20-AGO · 140.1 -> 140.2 kg (MEDIDA HASTA LA CRESTA, decision del usuario). Un lado
  // ya no se mide a VERTICE: es una medida recta que suma R + phi por cada doblez que lo
  // cierra (lado = tramo recto + R + phi). El unico numero de la semilla que se mueve es
  // el B del CBS 103B phi16: 590.4 -> 592.0, que es la luz util exacta de la viga
  // (600 - 2*4); esos 1.6 cm x 6 barras phi16 pesan 0.1 kg. Las patas 30/30 son FIJAS:
  // las escribio el usuario y ni la cresta ni el redondeo las tocan.
  ok(res.resumen.items === 4 && res.resumen.barras === 72 && res.resumen.kg === 140.2,
    'viga-semilla en {items:4, barras:72, kg:140.2} — la referencia viva');
  // (14-ago, Modelo A) la TRV es un longitudinal de_pie: mismo 50.4, pero la
  // aritmética llega por resta directa del largo útil local — sin cola flotante.
  const firma = res.barras.map(b => [b.figura, b.cant, b.dim_a, b.dim_b, b.dim_c, b.dim_d].join('|')).join(' ; ');
  // 18-AGO · el ÚNICO número que se movió es el B del CBS: 547.9735931288072 → 590.4.
  // Con la CONVENCIÓN DE VÉRTICE (cerrada por el usuario) los 45° de la 103B son el
  // ángulo ENTRE la pata y el cuerpo: patas REPLEGADAS en vez de abiertas, o sea que
  // dejan de robarle largo al tramo B. Las otras tres barras quedan idénticas dígito a
  // dígito, cola de flotante incluida.
  // 20-AGO · MEDIDA HASTA LA CRESTA + REDONDEO AL CENTÍMETRO: el B del CBS sube de
  // 590.4 a 592 (su medida ahora incluye el R + φ de cada codo → la luz útil exacta)
  // y la TRV baja de 50.4 a 50 (lado 'auto' limitado por el hormigón → hacia ABAJO).
  // Las patas fijas 30/30 y el estribo 24/52/24/52 quedan idénticos.
  ok(firma === [
    '103B|6|30|592|30|', '101A|4|592|||',
    '104D|47|24|52|24|52', '101A|15|50|||'
  ].join(' ; '), 'las 4 barras salen con las dims de la medida nueva (=' + firma + ')');
  // Y la semilla no estrena NI UN aviso. Sus dims 'auto' las resolvió el motor
  // contra el hormigón, así que medir y dibujar salen del mismo sitio y no hay
  // nada que decir; y sus dos dims FIJAS (las patas A/C del cabezal 103B) están en
  // una figura que se dibuja tramo a tramo, o sea sí mueven el trazo. Un aviso acá
  // sería RUIDO, y el ruido mata el canal: si esta corrección avisara de más, la
  // receta de referencia del proyecto sería la primera en ensuciarse.
  const recS = S.semillaViga();
  recS.componentes.forEach(c => R.expandirComponente(c, recS.geometria));
  const ruido = recS.componentes.filter(c => (c._avisos || []).length)
    .map(c => c.comp_id + ': ' + JSON.stringify(c._avisos));
  ok(ruido.length === 0, 'los 4 componentes de la semilla se expanden sin un solo aviso (=' +
    JSON.stringify(ruido) + ')');

  // EL GANCHO SIN TOCAR SIGUE SIENDO EL NORMATIVO — Y AHORA EL TRAZO LO SIGUE AL
  // CENTÍMETRO. Hasta el 20-ago el canal `ganchoDim` sólo viajaba si el usuario había
  // escrito la pata: derivada valía lo mismo en la dim y en el trazo salvo el último
  // bit del flotante. Con el REDONDEO eso dejó de ser cierto (la dim de cresta 10.4 se
  // lista 11 y el trazo seguía en 8.0), así que ahora viaja SIEMPRE y el dibujo sale
  // del mismo número que se corta: pata dibujada = 11 − (R + φ) = 8.6, o sea 1.1 más
  // por gancho y 2.2 más de perímetro. Ese es el precio —medido— de que el trazo no
  // mienta sobre la barra.
  const pl = R.expandirComponente(comp('106A', 'ES'), HOST);
  casi(perimetro(pl[0].puntos), 171.41365879, 1e-6,
    '106A ES con todo en auto: el perímetro dibujado sigue a la dim redondeada (169.21 → 171.41)');
  casi(pl[0].dims.A, 11, 1e-9,
    'y su gancho A sigue siendo la pata normativa: 10φ mín 7.5 hasta la cresta = 10.4, ' +
    'redondeada ARRIBA por ser un mínimo = 11');
}

// ============================================ B · Δ EN UN GANCHO → EL TRAZO CRECE
console.log('\nB — Δ en un gancho declarado: el dibujo crece lo mismo que el corte');
{
  // El caso del hallazgo, con sus números medidos: 106A rol estribo φ8 en la
  // viga-semilla. dim_a 7.5 → 12.5 · largo 167 → 172 · kg 142.8 → 143.8 (18-ago: los dos
  // totales subieron 4.0 kg con la convención de vértice; el Δ entre ellos es el mismo). Eso ya
  // estaba bien (el despiece nunca estuvo corrupto); lo que estaba mal es que el
  // perímetro dibujado se quedaba en 169.213659.
  function semilla106(delta) {
    const rec = S.semillaViga();
    const es = rec.componentes[2];
    es.figura = '106A';
    es.dims = { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' },
      D: { modo: 'auto' }, E: { modo: 'auto' }, F: { modo: 'auto' } };
    if (delta != null) es.dims.A.delta = delta;
    const out = G.generarViga(rec, {});
    return { out: out, barra: out.barras.find(b => b.figura === '106A') };
  }
  const s0 = semilla106(null), s5 = semilla106(5);
  // 20-AGO: el gancho normativo φ8 medido hasta la cresta vale 8.0 + 2.4 = 10.4 y se
  // lista 11 (mínimo normativo → hacia arriba). El Δ se suma DESPUÉS y entero: 16.
  casi(s0.barra.dim_a, 11, 1e-9, 'sin Δ: dim_a = 11 (gancho normativo φ8 hasta la cresta)');
  casi(s5.barra.dim_a, 16, 1e-9, 'con Δ +5: dim_a = 16');
  casi(s0.barra._largoEstimado, 174, 1e-9, 'largo de corte sin Δ = 174 cm');
  casi(s5.barra._largoEstimado, 179, 1e-9, 'largo de corte con Δ = 179 cm (+5, como debe)');
  // 18-AGO: la base de la semilla pasó de 136.1 a 140.1 (convención de vértice, ver
  // bloque A), así que estos dos totales suben los mismos 4.0 kg: 138.8 → 142.8 y
  // 139.8 → 143.8. El Δ que mide el bloque (+1.0 kg entre uno y otro) no se mueve.
  casi(s0.out.resumen.kg, 144.3, 0.05, 'kg sin Δ = 144.3');
  casi(s5.out.resumen.kg, 145.2, 0.05, 'kg con Δ = 145.2');

  // LO QUE ESTE TEST EXISTE PARA VIGILAR: el trazo. Antes 169.213659 → 169.213659.
  const p0 = perimetro(R.expandirComponente(comp('106A', 'ES'), HOST)[0].puntos);
  const p5 = perimetro(R.expandirComponente(comp('106A', 'ES', c => { c.dims.A.delta = 5; }), HOST)[0].puntos);
  casi(p5 - p0, 5, 1e-9, '106A ES ΔA +5: la polilínea 3D crece 5.000000 cm (era 0.000000)');

  // Y no es un caso suelto: las CUATRO figuras 106x, sus DOS ganchos y los DOS
  // roles. Son las 16 combinaciones que el barrido marcaba mudas.
  let sincronizadas = 0;
  ['106A', '106B', '106C', '106D'].forEach(f => {
    ['ES', 'CBS'].forEach(t => {
      ['A', 'F'].forEach(L => {
        const a = R.expandirComponente(comp(f, t), HOST);
        const cB = comp(f, t, c => { c.dims[L].delta = 5; });
        const b = R.expandirComponente(cB, HOST);
        const dCorte = sumaDims(b[0].dims) - sumaDims(a[0].dims);
        const dTrazo = perimetro(b[0].puntos) - perimetro(a[0].puntos);
        if (Math.abs(dCorte - 5) < 1e-9 && Math.abs(dTrazo - 5) < 1e-9) sincronizadas++;
        else console.error('    ' + f + ' ' + t + ' Δ' + L + ': corte +' + dCorte.toFixed(3) +
          ' vs trazo +' + dTrazo.toFixed(3));
      });
    });
  });
  ok(sincronizadas === 16,
    'las 16 combinaciones 106x × {A,F} × {ES,CBS} mueven trazo y corte lo mismo (=' +
    sincronizadas + '/16)');

  // LOS DOS GANCHOS SON INDEPENDIENTES: A y F son dos dims distintas del catálogo
  // y el trazador dibuja dos patas distintas. Si compartieran largo (como antes,
  // que era UNA constante para las dos), un Δ en A movería también la punta de F.
  const solaA = R.expandirComponente(comp('106A', 'ES', c => { c.dims.A.delta = 5; }), HOST)[0];
  const ambas = R.expandirComponente(comp('106A', 'ES', c => { c.dims.A.delta = 5; c.dims.F.delta = 5; }), HOST)[0];
  casi(perimetro(ambas.puntos) - perimetro(solaA.puntos), 5, 1e-9,
    'Δ en F suma su propio 5 (las dos patas son independientes, no una constante común)');
}

// ================================================ C · SIN CLAMP AL GANCHO
console.log('\nC — un gancho que no cabe se dibuja igual y se avisa (nada de recortarlo)');
{
  // La pata NORMATIVA sí se acota al sitio real del marco, y con razón: es un
  // número que eligió el motor y un anillo anidado no puede ensanchar. Pero una
  // medida que ESCRIBIÓ el usuario no se recorta ni a la norma ni al hormigón —
  // recortarla dibujaría un estribo que cabe mintiendo sobre la barra que se corta.
  const c = comp('106A', 'ES', x => { x.dims.A.delta = 60; });
  const pl = R.expandirComponente(c, HOST);
  const p0 = perimetro(R.expandirComponente(comp('106A', 'ES'), HOST)[0].puntos);
  casi(perimetro(pl[0].puntos) - p0, 60, 1e-9,
    'Δ +60 en el gancho: el trazo crece los 60 enteros, sin tope');
  ok(avisosDe(c).some(a => /FUERA del hormig/.test(a)),
    'y el aviso de fierro fuera del hormigón lo dice, medido sobre esos puntos (=' +
    JSON.stringify(avisosDe(c).filter(a => /FUERA/.test(a))) + ')');
}

// ============ D · LA FIGURA ABIERTA DE SECCIÓN YA NO ES MUDA: SE DIBUJA (22-ago)
console.log('\nD — 103B con rol de sección: el trazo SIGUE a la dim (antes era muda)');
{
  // ESTE BLOQUE DECÍA LO CONTRARIO, Y CONGELABA EL DEFECTO. Su texto era: «una 103B
  // (figura ABIERTA de 3 lados) forzada a rol de sección cae en el constructor de
  // MARCO, que traza el rectángulo del hormigón sin mirar las dims», y de ahí
  // concluía que «acá NO hay número que corregir» y que el fix correcto era AVISAR.
  // El aviso era honesto, pero la causa NO era inevitable: quien mandaba la 103B al
  // constructor de marco era la rama `rol === 'estribo'` de `familiaDeDibujo`, o sea
  // la TIPOLOGÍA pisando la TOPOLOGÍA (reglas.rolDeComponente traduce ES/EC/ESC →
  // 'estribo', así que ramificar por rol es ramificar por tipología).
  // MEDIDO sobre el catálogo: 17 de las 63 figuras se redibujaban así, las 17 con los
  // MISMOS 35 puntos y el MISMO perímetro de 170.214 cm — un 103B, un 103A y un 102A
  // bajo EC eran la misma barra dígito a dígito. El usuario lo reportó como «puse un
  // estribo de confinamiento con figura 103B y me insertó una 106A».
  // Con la rama fuera, la 103B se dibuja como su cadena EN EL PLANO DE LA SECCIÓN y
  // sus dims llegan al trazo: los 46 casos mudos del barrido F bajaron a 0 — no
  // porque se avisen mejor, sino porque dejaron de existir.
  const a = R.expandirComponente(comp('103B', 'ES'), HOST);
  const cD = comp('103B', 'ES', c => { c.dims.B.delta = 5; });
  const b = R.expandirComponente(cD, HOST);
  casi(b[0].dims.B, a[0].dims.B + 5, 1e-9, '103B ES: la dim B sube el Δ (el corte es correcto)');
  casi(perimetro(b[0].puntos) - perimetro(a[0].puntos), 5, 1e-9,
    'y el trazo crece los MISMOS 5 cm (antes: 0.000000, y se avisaba de dim muda)');
  ok(avisosDelTrazo(cD).length === 0,
    'ya no hay nada que confesar: cero avisos de trazo (=' + JSON.stringify(avisosDelTrazo(cD)) + ')');
  // Y con los tres lados a la vez: los tres mueven el dibujo, y lo que crece el trazo
  // es exactamente lo que crece el corte.
  const c3 = comp('103B', 'ES', c => { c.dims.A.delta = 5; c.dims.B.delta = 5; c.dims.C.delta = 5; });
  const b3 = R.expandirComponente(c3, HOST);
  casi(perimetro(b3[0].puntos) - perimetro(a[0].puntos),
    sumaDims(b3[0].dims) - sumaDims(a[0].dims), 1e-9,
    'los 3 lados con Δ: trazo y corte crecen lo mismo');
  ok(avisosDelTrazo(c3).length === 0,
    '…y ninguno avisa (=' + JSON.stringify(avisosDelTrazo(c3)) + ')');

  // EL CANAL DE AVISO NO SE MURIÓ: SE QUEDÓ SIN CLIENTES EN EL CATÁLOGO ACTUAL, y
  // sigue siendo la red para una figura que se dibuje DEL MARCO y traiga un lado que
  // el marco no lleva. Se prueba con una figura SINTÉTICA: un marco cerrado de 4
  // lados cuyas letras no son A–D (el marco dibuja A/C = ancho y B/D = alto), así que
  // sus dims no tienen por dónde llegar al trazo. Si esto dejara de avisar, el
  // silencio volvería por la puerta de atrás.
  {
    const cod = '__MARCOGHIJ__';
    CAT.FIGURAS[cod] = { codigo: cod, parciales: ['G', 'H', 'I', 'J'],
      angulos: [135, 135, 135, 135], radio: false, geometria: null };
    ok(FP.familiaDeDibujo(cod) === 'estribo' && FP.canalDelTrazo(cod, 'estribo', 'G') === null,
      'figura sintética: marco cerrado con lados G–J → se dibuja del marco y su lado G ' +
      'no tiene canal (=' + FP.canalDelTrazo(cod, 'estribo', 'G') + ')');
    const cS = comp(cod, 'ES', c => { c.dims.G.delta = 5; });
    R.expandirComponente(cS, HOST);
    // UN solo aviso aunque sean dos lados (G y su par espejo I): es EL MISMO problema.
    ok(avisosDelTrazo(cS).length === 1 && /NO mueven? el trazo 3D/.test(avisosDelTrazo(cS)[0]),
      '…y el motor lo AVISA con las letras y los números (=' + JSON.stringify(avisosDelTrazo(cS)) + ')');
    delete CAT.FIGURAS[cod];
  }
}

// ============== E · DIM FIJA SOBRE EL MARCO: LO MANDA IGUAL QUE EL Δ (21-ago)
console.log('\nE — el marco obedece a la medida escrita, no sólo al Δ');
{
  // REGLA NUEVA (21-ago). Antes este bloque congelaba lo contrario —«el marco lo
  // fija el hormigón: una medida fija no lo mueve»— y el motor lo AVISABA. Esa
  // regla tenía una consecuencia que el usuario midió: el tirador del marco tenía
  // que escribir Δ (un ajuste RELATIVO) porque era lo único que movía el dibujo, y
  // un Δ no es una medida. Al achicar el muro de 600 a 200 el 'auto' bajaba y el Δ
  // seguía montado encima: el estribo se achicaba DOS VECES — MEDIDO, Δ −30 sobre
  // un lado cuyo auto valía 13 dejaba el lado en −17 cm.
  // Ahora la medida fija manda el marco, así que el tirador puede escribir MEDIDA y
  // el estribo mide lo mismo con el muro en 600 que con el muro en 200.
  const cFija = comp('104D', 'ES', c => { c.dims.B = { modo: 'fija', valor: 80 }; });
  const bF = R.expandirComponente(cFija, HOST);
  ok(avisosDelTrazo(cFija).length === 0,
    'dim B fija en 80: NINGÚN aviso de dim muda — el trazo ya la lleva (=' +
    JSON.stringify(avisosDelTrazo(cFija)) + ')');
  const aF = R.expandirComponente(comp('104D', 'ES'), HOST);
  // B fija en 80 se replica en su par espejo D (los dos miden el alto del marco, 52
  // en 'auto'): el corte sube 2×28 = 56 y el rectángulo dibujado sube los mismos 56
  // de perímetro. Medir y dibujar, el mismo número.
  ok(Number(bF[0].dims.B) === 80 && Number(bF[0].dims.D) === 80,
    'el par espejo D sigue a B (80/80; en auto valían 52) (=' +
    bF[0].dims.B + '/' + bF[0].dims.D + ')');
  casi(perimetro(bF[0].puntos) - perimetro(aF[0].puntos),
    sumaDims(bF[0].dims) - sumaDims(aF[0].dims), 1e-9,
    'y el trazo crece exactamente lo que crece el corte (+56)');

  const a = R.expandirComponente(comp('104D', 'ES'), HOST);
  const cDelta = comp('104D', 'ES', c => { c.dims.B.delta = 5; });
  const b = R.expandirComponente(cDelta, HOST);
  ok(avisosDelTrazo(cDelta).length === 0,
    'el Δ sobre ese MISMO lado no avisa nada: sí crece el marco (=' +
    JSON.stringify(avisosDelTrazo(cDelta)) + ')');
  // Δ +5 en B se replica en su par espejo D (los dos miden el alto): el corte sube
  // 10 y el marco sube 5 de alto → el rectángulo dibujado crece 5 por arriba y por
  // abajo repartido, o sea +10 de perímetro. Corte y trazo, el mismo número.
  casi(perimetro(b[0].puntos) - perimetro(a[0].puntos),
    sumaDims(b[0].dims) - sumaDims(a[0].dims), 1e-9,
    'y el trazo crece exactamente lo que crece el corte (par espejo B↔D incluido)');
}

// ================================== F · BARRIDO COMPLETO: NI UN CASO EN SILENCIO
console.log('\nF — barrido de las 63 figuras: cero Δ que suba el corte sin mover ni avisar');
{
  let coherentes = 0, desiguales = 0, mudasConAviso = 0, mudasEnSilencio = [];
  CAT.codigos().forEach(cod => {
    const sp = CAT.get(cod);
    if (!sp) return;
    ['ES', 'CBS'].forEach(tip => {
      (sp.parciales || []).forEach(L => {
        let a, b;
        const cB = comp(cod, tip, c => { c.dims[L].delta = 5; });
        try { a = R.expandirComponente(comp(cod, tip), HOST); b = R.expandirComponente(cB, HOST); }
        catch (e) { return; }
        if (!a.length || !b.length) return;
        const dCorte = sumaDims(b[0].dims) - sumaDims(a[0].dims);
        if (Math.abs(dCorte) < 1e-9) return;          // el Δ no llegó a la dim: otro test
        const dTrazo = perimetro(b[0].puntos) - perimetro(a[0].puntos);
        if (Math.abs(dTrazo) < 1e-6) {
          if (avisosDelTrazo(cB).length) mudasConAviso++;
          else mudasEnSilencio.push(cod + ' ' + tip + ' Δ' + L);
        } else if (Math.abs(dTrazo - dCorte) > 1e-6) {
          desiguales++;
          console.error('    DESIGUAL ' + cod + ' ' + tip + ' Δ' + L +
            ': corte +' + dCorte.toFixed(3) + ' vs trazo +' + dTrazo.toFixed(3));
        } else coherentes++;
      });
    });
  });
  console.log('    coherentes=' + coherentes + ' · desiguales=' + desiguales +
    ' · mudas CON aviso=' + mudasConAviso + ' · mudas EN SILENCIO=' + mudasEnSilencio.length);
  ok(desiguales === 0, 'ningún Δ mueve el trazo una cantidad distinta de la del corte');
  ok(mudasEnSilencio.length === 0,
    'ningún Δ sube el corte sin mover el trazo Y sin avisar (=' +
    JSON.stringify(mudasEnSilencio.slice(0, 6)) + ')');
  // NÚMEROS EXACTOS DEL BARRIDO — son el "antes/después" del hallazgo y valen como
  // guard: si una figura nueva o un cambio de clasificación mueve el reparto entre
  // coherentes y mudas, este assert lo caza y obliga a explicar por qué.
  // 22-AGO · 472 → 518 coherentes y 46 → 0 mudas. Las 46 mudas eran EXACTAMENTE la
  // clase que este archivo describía como incorregible: «la figura que no se dibuja
  // de sus dims (101A, 102x, 103x y 201A con rol ES)». No era incorregible — era la
  // rama `rol === 'estribo'` de familiaDeDibujo mandándolas al constructor de MARCO,
  // o sea la tipología decidiendo el trazo. Con la rama fuera cada una se dibuja con
  // SUS puntos y sus dims llegan al dibujo: el problema desapareció en vez de
  // anunciarse. Ya no queda NI UNA dim muda en las 63 figuras del catálogo.
  ok(coherentes === 518,
    'coherentes = 518 (eran 472, y antes de esa tanda 456) =' + coherentes);
  ok(mudasConAviso === 0,
    'mudas = 0: las 46 de la tanda anterior eran las figuras abiertas que la ' +
    'tipología redibujaba como marco =' + mudasConAviso);
}

// ============================== G · CONTRATO DE `canalDelTrazo` (fuente única)
console.log('\nG — canalDelTrazo: por dónde entra al dibujo la medida de cada lado');
{
  ok(FP.canalDelTrazo('103B', 'cabezal', 'B') === 'dims',
    'cadena longitudinal → dims (la polilínea se construye tramo a tramo)');
  ok(FP.canalDelTrazo('106A', 'estribo', 'A') === 'gancho' &&
     FP.canalDelTrazo('106A', 'estribo', 'F') === 'gancho',
    '106A: A y F son GANCHOS declarados → llegan enteros por anchor.ganchoDim');
  ok(FP.canalDelTrazo('106A', 'estribo', 'B') === 'marco' &&
     FP.canalDelTrazo('106A', 'estribo', 'C') === 'marco',
    '106A: B..E llevan medida del MARCO → sólo el Δ los mueve');
  // 22-AGO · ANTES ESTE ASSERT PEDÍA `null` («103B con rol de sección: ninguna ruta —
  // el marco se dibuja sin mirar sus dims»), y ese null era el síntoma del defecto:
  // la 103B caía en el constructor de marco por su TIPOLOGÍA, no por su forma. Ahora
  // se dibuja como su cadena en el plano de la sección, así que su medida entra por
  // el mismo canal que en cualquier otra cadena: 'dims'.
  ok(FP.canalDelTrazo('103B', 'estribo', 'B') === 'dims',
    '103B con rol de sección: canal dims — se dibuja como su cadena, tramo a tramo');
  ok(JSON.stringify(FP.ganchosTerminales('106A', 'estribo')) === '{"ini":"A","fin":"F"}',
    'ganchosTerminales lee las letras de los tramos, no una tabla por código');
  ok(FP.ganchosTerminales('104D', 'estribo') === null,
    'y la 104D no declara ganchos (los suyos son implícitos): null, no una letra inventada');
}


// ============================================================================
// AVISO UNIVERSAL DEL LADO <= 0 + DIBUJO HONESTO (15-ago, del informe de revisión)
// ----------------------------------------------------------------------------
// Antes el único aviso de "no construible" vivía en el bucle del Δ: una FIJA
// negativa llegaba MUDA al payload y el 3D dibujaba un gancho normativo de 9.6
// donde se facturaba −5 (el fallback de _largoLado se tragaba el negativo).
// Ahora: aviso venga de donde venga el ≤ 0, y el trazo usa el número TAL CUAL.
(function () {
  console.log('\nG — lado fijo NEGATIVO: aviso universal y dibujo honesto');
  const cN = { tipologia: 'CBS', figura: '103B', diam: 1.6,
    pose: { cara: 'sup', lado: 1, rumbo: 'x' },
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'fija', valor: -5 }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 } };
  const pN = R.expandirComponente(cN, { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 });
  ok((cN._avisos || []).some(a => a.indexOf('lado B') >= 0 && a.indexOf('no es construible') >= 0),
    'la fija −5 AVISA (antes: mudo): ' + JSON.stringify((cN._avisos || [])[0] || ''));
  let lenN = 0; const ptsN = pN[0].puntos || [];
  for (let i = 1; i < ptsN.length; i++) {
    lenN += Math.hypot(ptsN[i].x - ptsN[i - 1].x, ptsN[i].y - ptsN[i - 1].y, ptsN[i].z - ptsN[i - 1].z);
  }
  ok(lenN < 69, 'y el trazo usa el −5 tal cual, sin gancho fantasma de 9.6 (largo ' +
    (Math.round(lenN * 10) / 10) + ', antes 69.6)');
})();

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
