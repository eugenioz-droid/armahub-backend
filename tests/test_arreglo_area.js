// =============================================================================
// ARREGLO POR ÁREA — DOS LÍNEAS DE DISTRIBUCIÓN · test headless (Node)
// =============================================================================
// Definición del usuario: «es casi como distribución pero aparece una segunda línea
// de distribución a lo largo del otro plano; los ejes deben salir de DONDE
// ingresamos la figura; misma lógica de snaps y con posibilidad de agregar tramos».
//
// CONTRATO que fija este test (el editor construye contra esto):
//   distribucion = { modo:'arreglo',
//                    rango:  { eje, from, to, sep, tramos? },   // 1ª línea
//                    rango2: { eje, from, to, sep, tramos? } }  // 2ª línea
//   · los dos `eje` van en ejes del MUNDO y se traducen con la POSE;
//   · `tramos` funciona en LAS DOS líneas, con el mismo redondeo y el mismo paso
//     real — las dos salen de `posicionesRango`, la única función que sabe repartir
//     un rango en este motor;
//   · sin `rango2` el arreglo clásico (n_capas / sep_capas / eje_capas) queda
//     EXACTAMENTE como estaba: hay recetas guardadas que dependen de él.
//
// QUÉ PROTEGE, en orden:
//   A. COMPATIBILIDAD: sin rango2, n_capas = 1 sigue siendo el lineal puro barra por
//      barra, y n_capas = 3 sigue apilando en su eje.
//   B. TRABA CLÁSICA DE MURO repartida en altura × largo: cuenta y posiciones
//      exactas, y 0 fierro fuera del hormigón.
//   C. ESTRIBO DE CONFINAMIENTO en 2 y 3 columnas cargadas a un costado.
//   D. TRAMOS EN AMBOS EJES: las posiciones son las de `posicionesRango`, no una
//      reimplementación (si alguien duplica la cuenta, esto falla).
//   E. LA OCUPACIÓN DE LA PIEZA VALE EN LOS DOS EJES: la barra ocupa su ancho en el
//      2º eje igual que en el 1º, y si el rango la saca del hormigón se AVISA con el
//      eje y los centímetros (no se clampa ninguna posición).
//   F. GUARDAS: los dos rangos por el mismo eje no son un área; capas + rango2 no
//      son una tercera dirección.
//   G. TECHO DE GENERACIÓN: el producto de las dos líneas explota igual de rápido
//      que rango × capas y se corta con el mismo tope y el mismo aviso.
//   H. LOS EJES SALEN DE LA POSE: la misma receta en dos poses reparte sobre los
//      ejes del mundo que declaró, no sobre los de antes de girar.
//
// Correr con: node tests/test_arreglo_area.js

'use strict';
const path = require('path');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

const CAT = require(path.join(BASE, 'catalogo_figuras.js'));
const FP = require(path.join(BASE, 'figura_puntos.js'));
const R = require(path.join(BASE, 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function casi(a, b, tol, m) { ok(Math.abs(Number(a) - Number(b)) <= tol, m + ' (' + a + ' vs ' + b + ')'); }

// Muro de referencia del proyecto (el de los defectos medidos de las tandas
// anteriores): 400 de largo × 250 de alto × 20 de espesor, recub 2.5.
const MURO = { largo: 400, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };

// Componente de muro. `rumbo` = el eje ⊥ al plano de la pieza (la POSE manda el
// plano de trabajo y, con él, los dos ejes sobre los que se puede repartir).
function comp(tip, fig, dist, rumbo, dimsFijas, diam) {
  const sp = CAT.get(fig) || {};
  const dims = {};
  (sp.parciales || []).forEach(p => {
    dims[p] = (dimsFijas && dimsFijas[p] != null) ? { modo: 'fija', valor: dimsFijas[p] } : { modo: 'auto' };
  });
  return {
    comp_id: 'X', jerarquia: 1, tipologia: tip, figura: fig, diam: diam || 10, suf_tipo: '',
    cara: 'lateral', recub_override: null, angulos: [], prioridad: null, empalme: null,
    depende_de: null, modo: 'arreglo', plano_pieza: { volteado: false },
    arreglo: { n_capas: 1, sep_capas: 20, rango: null }, dims: dims, distribucion: dist,
    pose: (rumbo === 'z') ? { cara: 'sup', lado: 1, rumbo: 'z' }
                          : { cara: 'lateral', lado: 1, rumbo: rumbo || 'y' }
  };
}
// CENTRO de una barra en un eje (su posición de reparto: es la coordenada que el
// rango escribe, no una punta).
function centro(pl, e) {
  const v = pl.puntos.map(q => q[e]);
  return Math.round(((Math.min(...v) + Math.max(...v)) / 2) * 1e4) / 1e4;
}
function centros(pls, e) {
  return [...new Set(pls.map(p => centro(p, e)))].sort((a, b) => a - b);
}
function extremos(pls, e) {
  let m = Infinity, M = -Infinity;
  pls.forEach(p => p.puntos.forEach(q => { if (q[e] < m) m = q[e]; if (q[e] > M) M = q[e]; }));
  return [m, M];
}
function fuera(c) { return (c._avisos || []).filter(a => a.indexOf('Fierro FUERA') === 0); }
function casiNum(a, b) { return Math.abs(a - b) < 1e-6; }

// ==================================================== A · COMPATIBILIDAD
console.log('A — sin rango2 el arreglo clásico no se mueve');
{
  const rango = { eje: 'x', from: -190, to: 190, sep: 95 };
  const cA = comp('EC', '305A', { modo: 'arreglo', rango: rango, n_capas: 1 }, 'y', { A: 14, B: 30, C: 14, D: 30, E: 14 }, 8);
  const cL = comp('EC', '305A', { modo: 'linear', rango: rango }, 'y', { A: 14, B: 30, C: 14, D: 30, E: 14 }, 8);
  const a = R.expandirComponente(cA, MURO), l = R.expandirComponente(cL, MURO);
  ok(a.length === 5 && l.length === 5, 'n_capas = 1: 5 barras, las mismas que el lineal puro');
  ok(JSON.stringify(a.map(p => p.puntos)) === JSON.stringify(l.map(p => p.puntos)),
    'y los puntos son IDÉNTICOS byte a byte (la garantía "arreglo(1 capa) == lineal")');

  // (Modelo A) las capas hacia el núcleo tienen sentido en una pieza ANCLADA a
  // una cara: la traba vertical (rumbo y, pegada a su cortina) se apila @4.
  const c3 = comp('TR', '101A', { modo: 'arreglo', rango: rango, n_capas: 3, sep_capas: 4, eje_capas: 'z' }, 'y');
  const p3 = R.expandirComponente(c3, MURO);
  ok(p3.length === 15, 'n_capas = 3: 5 × 3 = 15 barras');
  const cz = centros(p3, 'z');
  ok(cz.length === 3 && casiNum(cz[1] - cz[0], 4) && casiNum(cz[2] - cz[1], 4),
    'las 3 capas se apilan @4 hacia el núcleo (z = ' + JSON.stringify(cz) + ')');
}

// ============================================= B · TRABA CLÁSICA DE MURO
console.log('\nB — traba clásica de muro: altura × largo');
{
  // (Modelo A, 14-ago) La traba es un LONGITUDINAL: para COSER las cortinas
  // corre en z (pose {sup, rumbo z} — girada con ESPACIO desde como se dibuja).
  // La 102B (cuerpo + gancho 135) es la grapa real: su cuerpo B se estira al
  // espesor útil y su gancho A queda normativo. La ALTURA son CAPAS hacia el
  // núcleo desde su cara sup (la lógica cabezal de siempre); el LARGO, su rango.
  const c = comp('TR', '102B', {
    modo: 'arreglo',
    rango: { eje: 'x', from: -190, to: 190, sep: 95 },
    n_capas: 3, sep_capas: 115, eje_capas: 'y'
  }, 'z', null, 12.5);
  const pls = R.expandirComponente(c, MURO);
  ok(pls.length === 15, '5 posiciones a lo largo × 3 en altura = 15 trabas (' + pls.length + ')');
  ok(JSON.stringify(centros(pls, 'x')) === JSON.stringify([-190, -95, 0, 95, 190]),
    'a lo largo: −190 / −95 / 0 / 95 / 190 (paso real 95, cerrando el intervalo)');
  const cy = centros(pls, 'y');
  ok(cy.length === 3 && casiNum(cy[1] - cy[0], 115) && casiNum(cy[2] - cy[1], 115),
    'en altura: 3 capas @115 (y = ' + JSON.stringify(cy) + ')');
  const sitios = new Set(pls.map(p => centro(p, 'x') + '|' + centro(p, 'y')));
  ok(sitios.size === 15, 'las 15 caen en 15 sitios distintos del plano del muro');
  // LA BARRA CRUZA EL ESPESOR: cuerpo B al espesor útil, gancho A normativo.
  const z = extremos(pls, 'z');
  ok(z[1] - z[0] > 12 && z[1] - z[0] <= 16,
    'cada traba cruza el espesor (span z = ' + (z[1] - z[0]).toFixed(2) + ')');
  // 18-AGO · CONVENCIÓN DE VÉRTICE (cerrada por el usuario): B pasa de 13.125 a
  // 9.0717 y hay que decir por qué. Los 135° que la ficha de la 102B declara son
  // ahora el ángulo ENTRE el gancho y el cuerpo, o sea un quiebre ABIERTO de 45° de
  // RECORRIDO — antes se leía al revés (gancho replegado de 135° de recorrido).
  // Un gancho abierto AVANZA sobre el eje del cuerpo en vez de volver sobre él:
  //     sobresCadena pasa de 0.625 (sólo φ/2 de cresta) a
  //     7.5·cos45 + φ/2 = 5.3033 + 0.625 = 5.9283 por punta
  // y el 'auto' de B se encoge lo mismo para que la pieza siga cruzando el espesor
  // útil SIN salirse — que es lo que este bloque protege y sigue verde arriba
  // (span z entre 12 y 16, y `fuera(c)` vacío). O sea: el cuerpo ya no vale por sí
  // solo el espesor, lo cruzan el cuerpo MÁS la proyección de su gancho, y los dos
  // números salen del MISMO ángulo. El gancho sigue siendo el mínimo normativo.
  ok(Math.abs(pls[0].dims.B - 9.0717) < 1e-3 && pls[0].dims.A === 7.5,
    'cuerpo + proyección del gancho cruzan el espesor, con el gancho en el mínimo ' +
    'normativo (B=' + pls[0].dims.B + ', A=' + pls[0].dims.A + ')');
  ok(fuera(c).length === 0, 'ninguna de las 15 se sale del hormigón: ' + JSON.stringify(fuera(c)));
  const x = extremos(pls, 'x'), y = extremos(pls, 'y');
  ok(x[0] > -200 && x[1] < 200 && y[0] >= -125 && y[1] <= 125 && z[0] > -10 && z[1] < 10,
    'bbox dentro del muro: x[' + x[0].toFixed(1) + ',' + x[1].toFixed(1) + '] y[' +
    y[0].toFixed(1) + ',' + y[1].toFixed(1) + '] z[' + z[0].toFixed(1) + ',' + z[1].toFixed(1) + ']');
}

// ================================ C · ESTRIBO DE CONFINAMIENTO, 2 Y 3 COLUMNAS
console.log('\nC — estribo de confinamiento en 2 y 3 columnas cargadas a un costado');
{
  // LA PIEZA. El estribo del elemento de borde es un marco CHICO (no el que encuadra
  // toda la sección): por eso va con dims FIJAS y con una figura que se dibuja CON
  // SUS DIMS — la 305A, cadena de sección de 5 tramos cuyos lados miden alternando
  // ancho ('u') y alto ('v'). Un 104D no sirve para esto y no es un olvido: su forma
  // la manda el marco de núcleo, así que siempre ocuparía la sección entera.
  ok(JSON.stringify(FP.ejesCadenaSeccion('305A', 'estribo')) ===
     JSON.stringify({ A: 'u', B: 'v', C: 'u', D: 'v', E: 'u' }),
    '305A: sus lados miden alternando espesor (u) y largo (v) — es un marco de 14 × 30');

  // "Cargadas a un costado" = las 2 o 3 columnas juntas en un extremo del muro. El
  // primer centro va a −184.6 y no a −190 porque la pieza OCUPA 30 cm en ese eje
  // (± 15) más su φ/2: ahí es donde toca el borde del hormigón exacto (ver bloque E).
  [[2, -184.6, -169.6], [3, -184.6, -154.6]].forEach(([nCol, from, to]) => {
    const dist = {
      modo: 'arreglo',
      rango:  { eje: 'y', from: -115, to: 115, sep: 115 },   // en ALTURA (el @ del confinamiento)
      rango2: { eje: 'x', from: from, to: to, sep: 15 }      // las COLUMNAS, al costado
    };
    const c = comp('EC', '305A', dist, 'y', { A: 14, B: 30, C: 14, D: 30, E: 14 }, 8);
    const pls = R.expandirComponente(c, MURO);
    ok(pls.length === 3 * nCol,
      nCol + ' columnas × 3 alturas = ' + (3 * nCol) + ' estribos (' + pls.length + ')');
    ok(centros(pls, 'x').length === nCol,
      '…repartidos en ' + nCol + ' posiciones a lo largo: ' + JSON.stringify(centros(pls, 'x')));
    ok(JSON.stringify(centros(pls, 'y')) === JSON.stringify([-115, 0, 115]),
      '…y en las 3 alturas del rango de confinamiento');
    // TODAS al mismo costado: el centro del grupo está en la mitad izquierda.
    const cx = centros(pls, 'x');
    ok(cx[cx.length - 1] < -100, 'las ' + nCol + ' columnas quedan cargadas al costado −x');
    // El marco de cada estribo mide lo que dicen sus dims fijas.
    const z = extremos(pls, 'z');
    casi(z[1] - z[0], 14, 1e-9, 'cada estribo mide 14 cm en el espesor (su dim A/C/E)');
    ok(fuera(c).length === 0, '0 fierro fuera del hormigón: ' + JSON.stringify(fuera(c)));
  });
}

// ==================================================== D · TRAMOS EN AMBOS EJES
console.log('\nD — tramos (zonas con @ distinto) en LAS DOS líneas');
{
  // (305A ocupa 30 cm en x: el rango parte donde la pieza CABE, como en el bloque C)
  const r1 = { eje: 'x', from: -184.6, to: 184.6, sep: 95, tramos: [{ long: 100, sep: 50 }, { long: 200, sep: 100 }] };
  const r2 = { eje: 'y', from: -115, to: 115, sep: 115, tramos: [{ long: 60, sep: 30 }] };
  const c = comp('EC', '305A', { modo: 'arreglo', rango: r1, rango2: r2 }, 'y', { A: 14, B: 30, C: 14, D: 30, E: 14 }, 8);
  const pls = R.expandirComponente(c, MURO);

  // EL GUARD FUERTE: las posiciones tienen que ser EXACTAMENTE las de
  // `posicionesRango`, la misma función que usa el lineal. Si alguien vuelve a
  // calcular el reparto dentro del arreglo (que es como se rompió antes la garantía
  // "1 capa == lineal puro"), los dos números dejan de coincidir y esto falla.
  const esp1 = R.posicionesRango(r1, undefined);
  const esp2 = R.posicionesRango(r2, undefined);
  ok(esp1.length === 6 && esp2.length === 9,
    'la receta pide 6 posiciones a lo largo (@50 los primeros 100, @100 el resto) y 9 en altura ' +
    '(@30 los primeros 60, el último @ continúa hasta el tope)');
  ok(JSON.stringify(centros(pls, 'x')) === JSON.stringify(esp1.map(v => Math.round(v * 1e4) / 1e4)),
    'a lo largo: las posiciones son las de posicionesRango, tramo por tramo — ' + JSON.stringify(esp1));
  ok(JSON.stringify(centros(pls, 'y')) === JSON.stringify(esp2.map(v => Math.round(v * 1e4) / 1e4)),
    'en altura: ídem — ' + JSON.stringify(esp2.map(v => Math.round(v * 100) / 100)));
  ok(pls.length === esp1.length * esp2.length && pls.length === 54,
    'y el arreglo es el PRODUCTO de las dos líneas: 6 × 9 = 54 barras');
  ok(fuera(c).length === 0, '0 fierro fuera del hormigón con tramos en los dos ejes');
}

// ============================ E · LA OCUPACIÓN DE LA PIEZA VALE EN LOS DOS EJES
console.log('\nE — la pieza ocupa su ancho también en el 2º eje, y si no cabe se dice');
{
  // `from`/`to` son los CENTROS de la barra; la pieza ocupa 30 cm en ese eje (dims
  // fijas B/D) más φ/2 = 0.4 de cara. Con el primer centro en −185 la CARA del
  // fierro llega a −200.4 contra un muro que termina en −200: 0.4 cm fuera.
  // No se clampa la posición —eso escondería una receta imposible detrás de una
  // barra de aspecto normal—: se dibuja y se AVISA, con el eje y el número.
  const mk = from => {
    const dist = {
      modo: 'arreglo',
      rango:  { eje: 'y', from: -115, to: 115, sep: 115 },
      rango2: { eje: 'x', from: from, to: from + 30, sep: 15 }
    };
    const c = comp('EC', '305A', dist, 'y', { A: 14, B: 30, C: 14, D: 30, E: 14 }, 8);
    return { c: c, pls: R.expandirComponente(c, MURO) };
  };
  const justo = mk(-184.6), pasado = mk(-185);
  ok(justo.pls.length === 9 && pasado.pls.length === 9, 'las dos recetas colocan las mismas 9 barras');
  ok(fuera(justo.c).length === 0,
    'con el centro a −184.6 la cara del fierro toca EXACTO el borde: 0 cm fuera');
  ok(fuera(pasado.c).length === 1 && /0\.4 cm por el eje x/.test(fuera(pasado.c)[0]),
    'con el centro a −185 el aviso da el eje y los 0.4 cm: ' + JSON.stringify(fuera(pasado.c)[0]));
  casi(extremos(pasado.pls, 'x')[0], -200, 1e-9,
    'y la barra se dibuja donde la receta la puso (eje a −200), sin clamp que lo tape');

  // La ocupación se MIDE (no se pregunta la familia): es la misma cuenta que usa el
  // reparto de una pieza de sección, y vale igual en el eje x que en el z.
  casi(extremos(justo.pls, 'x')[1] - extremos(justo.pls, 'x')[0], 30 + 2 * 15,
    1e-9, 'las 3 columnas ocupan 30 (la pieza) + 30 (el reparto) = 60 cm en x');
}

// ================================================================ F · GUARDAS
console.log('\nF — guardas: dos rangos no son un área si apuntan al mismo eje');
{
  const c = comp('EC', '305A', {
    modo: 'arreglo',
    rango:  { eje: 'x', from: -190, to: 190, sep: 190 },
    rango2: { eje: 'x', from: -100, to: 100, sep: 100 }
  }, 'y');
  const pls = R.expandirComponente(c, MURO);
  ok(pls.length === 3, 'los dos rangos por el mismo eje: se ignora el 2º y queda el reparto de siempre (3)');
  ok((c._avisos || []).some(a => a.indexOf('2º rango ignorado') === 0 && /MISMO eje/.test(a)),
    '…con el aviso de que no hay segunda dirección: ' +
    JSON.stringify((c._avisos || []).filter(a => a.indexOf('2º rango') === 0)[0]));

  const c2 = comp('EC', '305A', {
    modo: 'arreglo', n_capas: 3, sep_capas: 5, eje_capas: 'z',
    rango:  { eje: 'x', from: -190, to: 190, sep: 190 },
    rango2: { eje: 'y', from: -100, to: 100, sep: 100 }
  }, 'y');
  const pls2 = R.expandirComponente(c2, MURO);
  ok(pls2.length === 9, 'capas + rango2: manda el área (3 × 3 = 9), las capas no multiplican');
  ok(JSON.stringify(centros(pls2, 'z')) === JSON.stringify([0]),
    '…y nada se apiló en el eje de las capas');
  ok((c2._avisos || []).some(a => a.indexOf('Capas ignoradas') === 0),
    '…con el aviso de que la 2ª línea YA es el arreglo por área');
}

// ============================================================ G · TECHO DURO
console.log('\nG — el producto de las dos líneas se corta en el mismo techo de siempre');
{
  const c = comp('EC', '305A', {
    modo: 'arreglo',
    rango:  { eje: 'x', from: -190, to: 190, sep: 5 },
    rango2: { eje: 'y', from: -115, to: 115, sep: 3 }
  }, 'y');
  const pls = R.expandirComponente(c, MURO);
  ok(pls.length === R.TOPE_PLACEMENTS_COMP,
    'la receta pide 77 × 78 = 6006 barras y el motor corta en ' + R.TOPE_PLACEMENTS_COMP);
  ok((c._avisos || []).some(a => a.indexOf('distribución truncada') === 0),
    '…y lo dice con el número que lo causó, en vez de congelar el navegador');
}

// ================================================== H · LOS EJES SALEN DE LA POSE
console.log('\nH — los ejes del arreglo se declaran en el MUNDO y los traduce la pose');
{
  // La MISMA distribución en dos poses distintas: los ejes declarados son los del
  // mundo, así que las coordenadas caen donde el usuario las puso las dos veces. Sin
  // la traducción de `rango2.eje` (que es la que agrega esta tanda a _cfgLocal), la
  // pieza girada repartiría su 2ª línea sobre el eje de antes de girar.
  const dist = () => ({
    modo: 'arreglo',
    rango:  { eje: 'x', from: -150, to: 150, sep: 150 },
    rango2: { eje: 'y', from: -100, to: 100, sep: 100 }
  });
  ['y', 'x'].forEach(rumbo => {
    const c = comp('EC', '305A', dist(), rumbo);
    const pls = R.expandirComponente(c, MURO);
    ok(JSON.stringify(centros(pls, 'x')) === JSON.stringify([-150, 0, 150]),
      'rumbo ' + rumbo + ': la 1ª línea reparte en el eje x del MUNDO');
    ok(JSON.stringify(centros(pls, 'y')) === JSON.stringify([-100, 0, 100]),
      'rumbo ' + rumbo + ': la 2ª línea reparte en el eje y del MUNDO');
    ok(pls.length === 9, 'rumbo ' + rumbo + ': 3 × 3 = 9 barras');
  });

  // Sin `eje` declarado en el 2º rango, se ELIGE MIDIENDO la pieza: de los dos ejes
  // libres, aquel sobre el que su cuerpo NO se desarrolla (repartir a lo largo del
  // propio desarrollo apilaría copias una encima de otra).
  const cSin = comp('EC', '305A', {
    modo: 'arreglo',
    rango:  { eje: 'x', from: -150, to: 150, sep: 150 },
    rango2: { from: -100, to: 100, sep: 100 }
  }, 'y');
  const pSin = R.expandirComponente(cSin, MURO);
  ok(JSON.stringify(centros(pSin, 'y')) === JSON.stringify([-100, 0, 100]),
    'sin eje declarado, la 2ª línea cae en y (la traba se desarrolla en z: ahí no se reparte)');
  ok(JSON.stringify(centros(pSin, 'z')) === JSON.stringify([0]),
    '…y el eje del desarrollo de la barra queda sin repartir, como debe');
}

// ============================================================================
// F · LA 2ª LÍNEA PUEDE REPARTIR POR EL EJE DE LA CARA (fix 15-ago)
// ----------------------------------------------------------------------------
// El guard del eje de cara protege la línea PRINCIPAL (ahí la coordenada la fija
// el recubrimiento). Pero una barra CORRE por un eje, así que de los dos que le
// quedan UNO ES SIEMPRE el de su cara: con el guard puesto, el arreglo por área
// no podía existir en NINGUNA figura abierta — la traba de muro pedía 5×3 y
// entregaba 5 con «2º rango ignorado». Declarar la 2ª línea ES decir "no te
// ancles ahí, repártete" (lo mismo que hacían las capas, con rango y arrastrable).
console.log('\nF — traba de muro: 5 a lo largo × 3 en altura, cruzando el espesor');
{
  const sp = CAT.get('102B');
  const dims = {};
  (sp.parciales || []).forEach(L => { dims[L] = { modo: 'auto' }; });
  const c = {
    comp_id: 'TM', jerarquia: 1, tipologia: 'TR', figura: '102B', diam: 8, suf_tipo: '',
    cara: 'sup', recub_override: null, angulos: [], prioridad: null, empalme: null,
    depende_de: null, modo: 'arreglo', plano_pieza: { volteado: false },
    arreglo: { n_capas: 1, sep_capas: 20, rango: null }, dims: dims,
    pose: { cara: 'sup', lado: 1, rumbo: 'z' },
    distribucion: {
      modo: 'arreglo',
      rango:  { eje: 'x', from: -190, to: 190, sep: 95 },
      rango2: { eje: 'y', from: -115, to: 115, sep: 115 }
    }
  };
  const pls = R.expandirComponente(c, MURO);
  ok(pls.length === 15, '5 × 3 = 15 trabas (' + pls.length + ')');
  ok(JSON.stringify(centros(pls, 'x')) === JSON.stringify([-190, -95, 0, 95, 190]),
    'a lo largo: ' + JSON.stringify(centros(pls, 'x')));
  ok(centros(pls, 'y').length === 3, 'en altura: 3 filas (' + JSON.stringify(centros(pls, 'y')) + ')');
  const z = extremos(pls, 'z');
  ok(z[1] - z[0] > 12 && z[1] - z[0] <= 16,
    'cada traba CRUZA el espesor (span z = ' + (z[1] - z[0]).toFixed(2) + ')');
  ok(fuera(c).length === 0 && (c._avisos || []).length === 0,
    'sin avisos y 0 fierro fuera: ' + JSON.stringify(c._avisos || []));
}

// ---------------------------------------------------------------------------
// G) LAS COLUMNAS DE UN ARREGLO DE ESTRIBOS SE REPARTEN DE VERDAD (17-ago)
// ---------------------------------------------------------------------------
// _estriboPerimetral ignoraba la coordenada del reparto: fila 1 y fila 2
// salian con bbox identico (columnas apiladas). Ahora cada fila se centra en
// su coordenada del rango2. Sin rango2 nada cambia (byte-identico).
console.log('— G) columnas del arreglo de estribos repartidas —');
(function () {
  var VIGA_G = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
  var spec = global.ModeladorCatalogoFiguras.get('104D'), dims = {};
  (spec.parciales || []).forEach(function (L) { dims[L] = { modo: 'auto' }; });
  var c = { comp_id: 'G', tipologia: 'ES', figura: '104D', diam: 1.0,
    pose: { postura: 'de_pie', rumbo: 'x' }, dims: dims, angulos: (spec.angulos || []).slice(),
    distribucion: { modo: 'arreglo', sep: 50, activa: true,
      rango: { from: -50, to: 50, sep: 50 },
      rango2: { from: -8, to: 8, sep: 16, eje: 'z' } } };
  c.distribucion.rango.eje = R.ejeDistribucion(c, VIGA_G);
  var pls = R.expandirComponente(c, VIGA_G) || [];
  ok(pls.length === 6, 'arreglo 3×2 = 6 placements: ' + pls.length);
  function czDe(pl) {
    var lo = Infinity, hi = -Infinity;
    (pl.puntos || []).forEach(function (q) { if (q.z < lo) lo = q.z; if (q.z > hi) hi = q.z; });
    return Math.round((lo + hi) / 2 * 100) / 100;
  }
  var porFila = {};
  pls.forEach(function (pl) { porFila[pl.meta.fila] = czDe(pl); });
  ok(porFila[1] === -8 && porFila[2] === 8,
    'cada fila centrada en su coordenada del 2º rango (-8 y 8): ' + JSON.stringify(porFila));
})();

// ---------------------------------------------------------------------------
// H) EL ESTRIBO ACHICADO Y CARGADO A UN LADO NO VUELVE AL MEDIO (17-ago)
// ---------------------------------------------------------------------------
// _restituirCentroVolteo consideraba «puntual» (span < 30% del host) al
// estribo achicado con extremo fin/ini y le restituia el centro: en modo
// Distribucion la pieza saltaba al medio del muro. El eje con delta
// direccional es un DATO del usuario y no se restituye.
console.log('— H) delta direccional sobrevive a la restitucion del volteo —');
(function () {
  var MURO_H = { largo: 400, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };
  function mkH(delta, extremo) {
    var c = { comp_id: 'H', tipologia: 'EC', figura: '104D', diam: 0.8,
      pose: { cara: 'lateral', lado: 1, rumbo: 'y' },
      dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
      distribucion: { modo: 'lineal', rango: { eje: 'y', from: 0, to: 0, sep: 50 } } };
    if (delta) c.dims.B = { modo: 'auto', delta: delta, extremo: extremo };
    return c;
  }
  function bxH(c) {
    var pls = R.expandirComponente(c, MURO_H) || [];
    var lo = Infinity, hi = -Infinity;
    (pls[0] && pls[0].puntos || []).forEach(function (q) { if (q.x < lo) lo = q.x; if (q.x > hi) hi = q.x; });
    return { lo: Math.round(lo * 10) / 10, hi: Math.round(hi * 10) / 10 };
  }
  var b0 = bxH(mkH());
  ok(b0.lo === -197.5 && b0.hi === 197.5, 'base llena el largo util: ' + JSON.stringify(b0));
  // -300 deja la pieza en span 95 < 120 (30% de 400): antes la restitucion la centraba
  var bf = bxH(mkH(-300, 'fin'));
  ok(bf.lo === -197.5, 'fin -300 sigue PEGADO al borde -197.5: ' + JSON.stringify(bf));
  var bi = bxH(mkH(-300, 'ini'));
  ok(bi.hi === 197.5, 'ini -300 sigue pegado al borde +197.5: ' + JSON.stringify(bi));
  // con crecimiento CENTRADO la restitucion sigue operando como siempre
  var bc = bxH(mkH(-300, 'centro'));
  ok(Math.abs(bc.lo + bc.hi) < 0.2, 'centro -300 queda centrado (como siempre): ' + JSON.stringify(bc));
})();

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exitCode = fallos ? 1 : 0;
