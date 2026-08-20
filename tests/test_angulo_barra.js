// =============================================================================
// ÁNGULO POR BARRA + UNA SOLA CONVENCIÓN DE ÁNGULO — test headless (Node)
// =============================================================================
// Dos cosas que son la misma: qué NÚMERO es el ángulo de una figura, y quién puede
// cambiarlo. Van juntas porque el defecto que las une es el de siempre en este
// motor: que el número que se MIDE y el que se DIBUJA sean distintos.
//
//   ÁNGULO POR BARRA — `comp.angulos[i]` manda sobre `spec.angulos[i]` del catálogo,
//   en el TRAZADO y en el payload. El catálogo SUGIERE (es el valor por defecto de la
//   ficha); el componente decide. Mover el ángulo mueve la POSICIÓN del gancho y NADA
//   más: ni un lado, ni el largo de corte, ni los kg. Y sólo dentro del rango de SU
//   doblez (0–90 si nace ≤90; 90–180 si nace >90): cruzar el rango es otra figura, así
//   que se ignora con aviso en vez de aproximar.
//
//   UNA SOLA CONVENCIÓN — el ángulo ES el DEL VÉRTICE: el que queda ENTRE LOS DOS
//   TRAMOS DE FIERRO que concurren en el doblez. NO es el recorrido del doblado
//   (vértice = 180 − recorrido). Convención CERRADA POR EL USUARIO el 18-ago-2026.
//   El caso que la fija es la 102B: su ficha dice 135° y ésos son los grados que se
//   miden entre la pata y el cuerpo; el recorrido de ese doblez es 180 − 135 = 45°.
//   HASTA EL 17-AGO ESTE ARCHIVO CONGELABA LA LECTURA CONTRARIA («el ángulo ES el
//   GIRO»). Medido sobre el trazo: las 40 figuras de familia 'cadena' con ángulo
//   declarado se dibujaban con el vértice en 180 − el de su ficha, o sea la 102B y
//   la 102C salían INTERCAMBIADAS. Se corrigió la LECTURA del trazador
//   (figura_puntos::_giroDeVertice) y el escritor del Diseñador; el DATO del
//   catálogo no se tocó. Todos los valores esperados marcados «18-ago» de este
//   archivo son ese cambio, y están MEDIDOS, no supuestos.
//
// QUÉ PROTEGE, en orden:
//   A. SIN override = comportamiento de hoy, byte por byte (viga-semilla
//      {items:4, barras:72, kg:140.1} y sus 4 ítems con sus ángulos).
//   B. CONGELA EL ÁNGULO POR BARRA: con dims FIJAS, mover el ángulo mueve la punta
//      del gancho y NO mueve ni una dim ni el largo de la polilínea.
//   C. RANGO: fuera del rango de su doblez se ignora, cae al catálogo y avisa.
//   D. EL ÁNGULO VIAJA AL DESPIECE (ang1..ang4) y agrupa como barra distinta.
//   E. MEDIR = DIBUJAR: con dims 'auto' el ángulo cambia las dims Y el trazo, y los
//      dos salen del MISMO número (el lado dibujado mide su dim resuelta).
//   F. DONDE EL TRAZO NO LEE ÁNGULOS (marco cerrado / traba clásica) se AVISA en vez
//      de dejar al usuario moviendo un control mudo.
//   G. CONVENCIÓN ÚNICA: el ángulo del catálogo es el VÉRTICE, el trazador lo
//      traduce a giro (180 − vértice) y el escritor del Diseñador guarda el vértice.
//
// Correr con: node tests/test_angulo_barra.js

'use strict';
const fs = require('fs');
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

// Componente longitudinal (rol cabezal) con las dims que se le pasen; `ang` es el
// override de ángulos del componente (null = la receta no lo declara).
function comp(fig, ang, dims, extra) {
  const sp = CAT.get(fig) || {};
  const d = {};
  (sp.parciales || []).forEach(p => {
    d[p] = (dims && dims[p] != null) ? { modo: 'fija', valor: dims[p] } : { modo: 'auto' };
  });
  const c = {
    comp_id: 'X', jerarquia: 2, tipologia: 'CBS', figura: fig, diam: 16, suf_tipo: '',
    cara: 'sup', recub_override: null, angulos: ang, prioridad: null, empalme: null,
    depende_de: null, modo: 'puntual', plano_pieza: { volteado: false },
    arreglo: { n_capas: 1, sep_capas: 20, rango: null }, dims: d,
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}
function expandir(c) { return R.expandirComponente(c, HOST); }
function largoPoli(p) {
  let L = 0;
  for (let i = 1; i < p.length; i++) {
    L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
  }
  return L;
}
function sumaDims(d) { let s = 0; for (const k in d) s += Number(d[k]); return s; }

// ---------------------------------------------------------------------------
// SOBRE DE CRESTA (20-ago) — LA DIM YA NO ES LA CADENA DE VERTICES
// ---------------------------------------------------------------------------
// Cada lado se mide RECTO hasta la cresta del codo: lado = tramo recto + R + phi por
// cada doblez que lo cierra. El motor traza por vertices, asi que el trazo mide la
// dim MENOS ese sobre. Los numeros de este archivo se escriben como
// «dim − sobre», no a mano: si manana cambia el radio de norma, siguen valiendo.
function sobre(fig, lado, phi, ang) {
  const sc = FP.sobresCresta(fig, 'cabezal', phi == null ? 1.6 : phi, ang || null);
  return Number(sc[lado]) || 0;
}
function sobreTotal(fig, phi, ang) {
  const sc = FP.sobresCresta(fig, 'cabezal', phi == null ? 1.6 : phi, ang || null);
  let s = 0; for (const k in sc) s += Number(sc[k]) || 0;
  return s;
}

// ---------------------------------------------------------------------------
// MEDIR VÉRTICES SOBRE UN TRAZO QUE PUEDE LLEVAR CODOS ARQUEADOS (18-ago)
// ---------------------------------------------------------------------------
// Un doblez de más de 90° de RECORRIDO lo dibuja `_conGanchosRadio` con el arco
// calibrado: donde había un vértice quedan ~15 puntos marcados `esArco`. Medir el
// ángulo entre puntos consecutivos ahí devuelve el paso del muestreo (~10°), no el
// doblez. Con la convención de VÉRTICE ese caso es TODA figura cuyo ángulo de ficha
// sea < 90° (una 103C, una 105B…), o sea justo las que este archivo mide.
// `segsRectos` colapsa cada corrida de arco quedándose con los tramos RECTOS
// (cuerpo y pata), y `verticesDe` mide entre esos tramos — que es la definición
// del ángulo del vértice, y es exacta: la pata cuelga tangente a la salida del arco.
function segsRectos(pts) {
  const s = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1].esArco && pts[i].esArco) continue;        // cuerda interna del codo
    const d = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y, z: pts[i].z - pts[i - 1].z };
    const L = Math.hypot(d.x, d.y, d.z);
    if (L > 1e-9) s.push({ d, L });
  }
  return s;
}
function verticesDe(pts) {
  const s = segsRectos(pts), o = [];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    const c = (a.d.x * b.d.x + a.d.y * b.d.y + a.d.z * b.d.z) / (a.L * b.L);
    o.push(Math.acos(Math.max(-1, Math.min(1, -c))) * 180 / Math.PI);   // 180 − recorrido
  }
  return o;
}
function semilla(mut) {
  const rec = S.semillaViga();
  if (mut) mut(rec);
  return { receta: rec, res: G.generarViga(rec, {}) };
}

// ============================================== A · SIN OVERRIDE = HOY, BYTE A BYTE
console.log('A — sin override efectivo el motor da EXACTAMENTE lo de siempre');
{
  const { res } = semilla();
  // 140.1 kg, MEDIDO el 18-ago (antes 136.1). La convención de VÉRTICE cerrada por
  // el usuario cambia lo que dibuja el CBS 103B de la semilla: sus 45° de ficha
  // pasan de ser el recorrido a ser el vértice, o sea de patas abiertas a patas
  // REPLEGADAS sobre el cuerpo. Replegadas ya no le roban largo al tramo B, así que
  // su 'auto' sube de 547.974 a 590.4 cm y esos 42.4 cm × 6 barras φ16 pesan 4.0 kg.
  // Las otras tres barras (2 × 101A y el estribo 104D) no se mueven ni un gramo.
  // 20-AGO · 140.1 -> 140.2 kg (MEDIDA HASTA LA CRESTA, decision del usuario). Un lado
  // ya no se mide a VERTICE: es una medida recta que suma R + phi por cada doblez que lo
  // cierra (lado = tramo recto + R + phi). El unico numero de la semilla que se mueve es
  // el B del CBS 103B phi16: 590.4 -> 592.0, que es la luz util exacta de la viga
  // (600 - 2*4); esos 1.6 cm x 6 barras phi16 pesan 0.1 kg. Las patas 30/30 son FIJAS:
  // las escribio el usuario y ni la cresta ni el redondeo las tocan.
  ok(res.resumen.items === 4 && res.resumen.barras === 72 && res.resumen.kg === 140.2,
    'viga-semilla en {items:4, barras:72, kg:140.2} — la referencia viva');
  const firma = res.barras.map(b => [b.figura, b.cant, b.ang1, b.ang2].join('|')).join(' ; ');
  ok(firma === ['103B|6|45|45', '101A|4||', '104D|47|135|135', '101A|15||'].join(' ; '),
    'los ang1..ang4 del despiece salen con los mismos valores que antes de la tanda');

  // La semilla YA declaraba `angulos` en sus componentes (103B [45,45], 104D
  // [135,135]) y son EXACTAMENTE los del catálogo: leerlos ahora no puede mover
  // nada. Eso es lo que hace que esta tanda sea inerte sobre lo guardado.
  const rec = S.semillaViga();
  ok(!FP.angulosCambian('103B', rec.componentes[0].angulos) &&
     !FP.angulosCambian('104D', rec.componentes[2].angulos),
    'los `angulos` que la semilla ya traía coinciden con el catálogo → override nulo');
  // Y las formas de "no hay override" son todas equivalentes.
  ['103C', '105I'].forEach(f => {
    ok(!FP.angulosCambian(f, null) && !FP.angulosCambian(f, []) &&
       !FP.angulosCambian(f, [null]) && !FP.angulosCambian(f, ['']),
      f + ': null / [] / [null] / [""] son todos "sin override"');
  });
  const sinOvr = expandir(comp('103C', null, { A: 20, B: 500, C: 20 }))[0];
  const conCat = expandir(comp('103C', [45], { A: 20, B: 500, C: 20 }))[0];
  ok(JSON.stringify(sinOvr.puntos) === JSON.stringify(conCat.puntos),
    'declarar el MISMO ángulo del catálogo dibuja los mismos puntos, byte por byte');
}

// ================================= B · EL ÁNGULO MUEVE LA PUNTA, NO EL LARGO
console.log('\nB — con dims FIJAS, mover el ángulo mueve la punta y NADA más');
{
  // Por qué dims FIJAS: es la condición en la que la frase del usuario («el largo
  // total debe seguir siendo el mismo») es comprobable sin ambigüedad. Con dims
  // 'auto' el largo SÍ cambia, y debe hacerlo: el 'auto' es una respuesta al
  // hormigón y la figura cambió de forma (eso lo cubre el bloque E).
  //
  // 103C: parciales A/B/C, el catálogo lista UN ángulo (45°) y `mapaAngulosFigura`
  // dice que gobierna el PRIMER doblez.
  //
  // QUÉ CAMBIÓ ACÁ EL 18-AGO. Con la convención de VÉRTICE, ese 45° de ficha es el
  // ángulo ENTRE la pata y el cuerpo: un gancho REPLEGADO, de 180 − 45 = 135° de
  // recorrido. Y un recorrido > 90° lo dibuja `_conGanchosRadio` con el arco
  // calibrado, así que la polilínea DEJA de ser la cadena de vértices: el cuerpo se
  // retranquea R = 2.5·φ = 4 cm (regla de la cresta) y el codo barre R·recorrido.
  // Antes, con la lectura contraria, este mismo caso era un quiebre de 45° de
  // recorrido —sin arco— y por eso el número congelado era 540 exacto. El invariante
  // del bloque NO cambia (mover el ángulo no toca ni una dim ni el largo de corte);
  // lo que cambia es que hay que medirlo sobre las dims y sobre los tramos RECTOS,
  // no sobre la suma cruda de puntos.
  ok(JSON.stringify(FP.mapaAngulosFigura('103C')) === '[0]',
    '103C: su único α gobierna el primer doblez (mapa leído del catálogo, no inventado)');
  const DIMS = { A: 20, B: 500, C: 20 };
  const base = expandir(comp('103C', null, DIMS))[0];
  casi(sumaDims(base.dims), 540, 1e-9, 'el LARGO DE CORTE es A+B+C = 540 cm');
  // 20-AGO: el DIBUJO baja los 7.2 cm del sobre de cresta (4.8 de la pata A + 1.6 del
  // cuerpo + 0.8 de la pata C): el largo de corte no sale del trazo doblado.
  casi(largoPoli(base.puntos), 545.413577 - sobreTotal('103C'), 1e-5,
    '…y con el gancho replegado de ficha el DIBUJO mide 545.413577 menos el sobre de cresta (=' +
    largoPoli(base.puntos).toFixed(6) + ')');
  const R_CODO = 4;   // 2·φ + φ/2 con φ16 — el radio de eje de `_conGanchosRadio`

  let puntas = [];
  [10, 30, 45, 60, 90].forEach(a => {
    const pl = expandir(comp('103C', [a], DIMS))[0];
    // Los TRES lados siguen dibujados con su medida: A y C completos y B retranqueado
    // el radio del codo. Es más fuerte que el viejo «la polilínea mide 540»: fija
    // lado por lado en vez de fijar sólo la suma. Con α = 90 no hay codo (recorrido
    // 90 = el fillet del motor) y B sale entero — por eso la excepción explícita.
    // 20-AGO: a cada lado se le descuenta SU sobre de cresta (la dim es hasta la
    // cresta; el trazo va por vertices). El sobre depende del angulo, asi que se
    // pregunta con el override puesto.
    const sA = sobre('103C', 'A', 1.6, [a]), sB = sobre('103C', 'B', 1.6, [a]), sC = sobre('103C', 'C', 1.6, [a]);
    const esp = (a === 90) ? [20 - sA, 500 - sB, 20 - sC] : [20 - sA, 500 - sB - R_CODO, 20 - sC];
    const s = segsRectos(pl.puntos).map(x => x.L);
    ok(s.length === 3 && s.every((v, i) => Math.abs(v - esp[i]) < 1e-6),
      'α1 = ' + a + '°: los 3 lados DIBUJADOS miden su dim menos el sobre: ' +
      esp.map(v => v.toFixed(3)).join('/') + ' (=' +
      s.map(v => v.toFixed(3)).join('/') + ')');
    casi(sumaDims(pl.dims), 540, 1e-9, 'α1 = ' + a + '°: el largo de corte sigue siendo 540 cm');
    ok(JSON.stringify(pl.dims) === JSON.stringify(base.dims),
      'α1 = ' + a + '°: las dims no se mueven (' + JSON.stringify(pl.dims) + ')');
    puntas.push(pl.puntos[0].x.toFixed(4) + ',' + pl.puntos[0].y.toFixed(4));
  });
  ok(new Set(puntas).size === 5,
    'las 5 posiciones de la PUNTA del gancho son distintas: ' + JSON.stringify(puntas));

  // EL ARCO DE UN DOBLEZ MÁS ABIERTO BARRE MENOS — física del doblado, no un error.
  // (Este assert vivía abajo, sobre la 102B; con la convención de vértice la 102B ya
  // no lleva arco —su ficha de 135° es un recorrido de 45°— y quien lo lleva es la
  // 103C. Es el mismo assert, medido donde ahora ocurre el fenómeno.)
  ok(largoPoli(expandir(comp('103C', [60], DIMS))[0].puntos) <
     largoPoli(expandir(comp('103C', [45], DIMS))[0].puntos),
    '103C: con α = 60° la polilínea es más corta que con α = 45° (el codo barre menos): ' +
    largoPoli(expandir(comp('103C', [45], DIMS))[0].puntos).toFixed(4) + ' → ' +
    largoPoli(expandir(comp('103C', [60], DIMS))[0].puntos).toFixed(4));

  // Y la geometría es la del doblez, no una aproximación: el VÉRTICE entre la pata A
  // y el cuerpo B mide exactamente el α declarado. Se mide con `verticesDe`, que
  // colapsa el codo arqueado — medir entre puntos consecutivos daría el paso del
  // muestreo del arco (~10°), que es lo que hacía la versión vieja de este assert
  // cuando el trazo no llevaba arco.
  [30, 60].forEach(a => {
    const p = expandir(comp('103C', [a], DIMS))[0].puntos;
    const v = verticesDe(p);
    casi(v[0], a, 1e-6, 'α1 = ' + a + '°: el VÉRTICE REAL entre A y B mide ' + a + '°');
    casi(v[1], 90, 1e-6, '…y el otro doblez sigue siendo el de escuadra');
    casi(segsRectos(p)[0].L, 20 - sobre('103C', 'A', 1.6, [a]), 1e-9,
      '…y la pata A sigue midiendo sus 20 cm menos el sobre de cresta');
  });

  // VÉRTICE > 90° (102B, catálogo 135°): es la otra familia, la del quiebre suave.
  // Con la convención de vértice su recorrido es 180 − 135 = 45°, o sea ≤ 90°, así
  // que el trazo NO lleva arco explícito y la polilínea SÍ es la cadena de vértices:
  // mide A+B EXACTO en todo su rango. (Antes de la corrección era al revés: la 102B
  // era la que llevaba arco y por eso su largo dibujado se movía con el ángulo.)
  {
    const d2 = { A: 20, B: 500 };
    const a0 = expandir(comp('102B', null, d2))[0];
    const a1 = expandir(comp('102B', [110], d2))[0];
    ok(JSON.stringify(a0.dims) === JSON.stringify(a1.dims),
      '102B: bajar el vértice de 135° a 110° no toca las dims (' + JSON.stringify(a1.dims) + ')');
    ok(Math.abs(a1.puntos[0].x - a0.puntos[0].x) > 1,
      '…pero la punta del gancho se mueve (' + a0.puntos[0].x.toFixed(2) + ' → ' + a1.puntos[0].x.toFixed(2) + ')');
    casi(largoPoli(a0.puntos), 520 - sobreTotal('102B'), 1e-9,
      '…y sin arco la polilínea mide A+B menos el sobre de cresta');
    casi(largoPoli(a1.puntos), 520 - sobreTotal('102B', 1.6, [110]), 1e-9,
      '…lo mismo con el vértice en 110° (el largo de CORTE no se mueve; el sobre sigue al ángulo)');
    casi(verticesDe(a0.puntos)[0], 135, 1e-9, '…y el vértice dibujado es el 135° de la ficha');
    casi(verticesDe(a1.puntos)[0], 110, 1e-9, '…y con override, los 110° pedidos');
  }

  // LA FAMILIA DEL VÉRTICE ABIERTO, BARRIDA ENTERA (103D, ficha 135°, rango 90–180).
  // Es la sucesora directa del viejo «la polilínea sigue midiendo 540 cm»: ahí el
  // barrido de 103C no llevaba arco y podía exigir el largo EXACTO en cada α. Con la
  // convención de vértice esa condición la cumple la familia > 90°, así que el
  // assert exacto se conserva — sólo cambia la figura sobre la que se mide.
  {
    const base135 = expandir(comp('103D', null, DIMS))[0];
    ok(JSON.stringify(FP.rangoAngulo('103D', 0)) === JSON.stringify({ lo: 90, hi: 180 }),
      '103D nace en 135° → su rango es 90–180');
    [90, 110, 135, 150, 170].forEach(a => {
      const pl = expandir(comp('103D', [a], DIMS))[0];
      ok(pl.puntos.length === 4, 'α1 = ' + a + '°: 4 puntos, sin codo arqueado (=' + pl.puntos.length + ')');
      casi(largoPoli(pl.puntos), 540 - sobreTotal('103D', 1.6, [a]), 1e-9,
        'α1 = ' + a + '°: la polilínea mide A+B+C menos el sobre de cresta (el corte sigue en 540)');
      casi(verticesDe(pl.puntos)[0], a, 1e-6, 'α1 = ' + a + '°: el vértice dibujado ES el declarado');
      ok(JSON.stringify(pl.dims) === JSON.stringify(base135.dims),
        'α1 = ' + a + '°: las dims no se mueven (' + JSON.stringify(pl.dims) + ')');
    });
  }
}

// ============================================================ C · RANGO DEL DOBLEZ
console.log('\nC — el ángulo se mueve dentro del rango de SU doblez, y no más');
{
  ok(JSON.stringify(FP.rangoAngulo('103C', 0)) === JSON.stringify({ lo: 0, hi: 90 }),
    '103C nace en 45° → su rango es 0–90');
  ok(JSON.stringify(FP.rangoAngulo('102B', 0)) === JSON.stringify({ lo: 90, hi: 180 }),
    '102B nace en 135° → su rango es 90–180');
  ok(JSON.stringify(FP.rangoAngulo('105I', 0)) === JSON.stringify({ lo: 90, hi: 180 }) &&
     JSON.stringify(FP.rangoAngulo('105I', 1)) === JSON.stringify({ lo: 0, hi: 90 }),
    '105I lista [135, 45]: cada α tiene el rango de SU doblez, no un rango de la figura');

  const DIMS = { A: 20, B: 500, C: 20 };
  const ref = expandir(comp('103C', null, DIMS))[0];
  // 120 cruzaría al otro rango; 0 y 180 son los extremos degenerados (sin doblez /
  // pata plegada sobre el cuerpo). Los tres se IGNORAN, no se recortan al tope.
  [120, 135, 0, 180, -45, 'ochenta'].forEach(mal => {
    const c = comp('103C', [mal], DIMS);
    const pl = expandir(c)[0];
    ok(JSON.stringify(pl.puntos) === JSON.stringify(ref.puntos),
      'α1 = ' + JSON.stringify(mal) + ' se ignora: el trazo queda idéntico al del catálogo');
    const av = (c._avisos || []).filter(a => a.indexOf('Ángulo 1') === 0);
    ok(av.length === 1, '…y queda UN aviso: ' + JSON.stringify(av[0] || null));
  });
  // El 90 es la frontera y pertenece a los DOS rangos: es un doblez legítimo venga
  // de donde venga (no se puede llegar a él "de rebote" desde el otro lado, porque
  // el rango lo fija el ángulo del CATÁLOGO, que no cambia).
  ok(FP.validarAngulo('103C', 0, 90).ok && FP.validarAngulo('102B', 0, 90).ok,
    '90° es válido en los dos rangos (es la frontera, y es un doblez real)');
  // Un slot que la figura no tiene tampoco se inventa.
  {
    const c = comp('103C', [45, 60], DIMS);
    expandir(c);
    ok((c._avisos || []).some(a => a.indexOf('Ángulo 2') === 0 && a.indexOf('no existe el 2') > 0),
      '103C con un α2: se avisa que la figura declara 1 solo ángulo');
  }

  // -------------------------------------------------------------------------
  // NINGÚN OVERRIDE YA GUARDADO SE CAE DEL RANGO AL CAMBIAR LA CONVENCIÓN
  // -------------------------------------------------------------------------
  // El rango lo fija el valor del CATÁLOGO, que NO cambió ni un dígito, y el corte
  // está en 90°, que es su propio espejo (180 − 90 = 90). Por lo tanto la partición
  // {(0,90], [90,180)} es la MISMA leída como vértice o como recorrido: todo valor
  // que una receta guardada tenía por válido lo sigue teniendo, y ninguno queda
  // fuera de rango en silencio. Lo que sí cambia es lo que ese número DIBUJA (un 110
  // guardado para una 102B dibujaba antes un recorrido de 110° y ahora un vértice de
  // 110°, o sea un recorrido de 70°) — la misma reinterpretación que reciben los
  // valores del catálogo, que es exactamente el cambio pedido.
  // Se comprueba ENUMERANDO el catálogo entero, slot por slot y grado por grado, en
  // vez de razonarlo: si alguien estrecha el rango, esto falla.
  {
    let slots = 0, malRango = [], malAceptados = [];
    CAT.codigos().forEach(f => {
      const cat = FP.angulosCatalogo(f) || [];
      cat.forEach((base, i) => {
        slots++;
        const esperado = (base <= 90) ? { lo: 0, hi: 90 } : { lo: 90, hi: 180 };
        if (JSON.stringify(FP.rangoAngulo(f, i)) !== JSON.stringify(esperado)) malRango.push(f + '/α' + (i + 1));
        for (let v = 0; v <= 180; v++) {
          const debe = (esperado.lo === 0) ? (v > 0 && v <= 90) : (v >= 90 && v < 180);
          if (FP.validarAngulo(f, i, v).ok !== debe) { malAceptados.push(f + '/α' + (i + 1) + '=' + v); break; }
        }
      });
    });
    ok(slots === 75 && malRango.length === 0,
      'los ' + slots + ' slots de ángulo del catálogo tienen el rango de SU doblez (' +
      (malRango.length ? malRango.join(',') : 'ninguna discrepancia') + ')');
    ok(malAceptados.length === 0,
      'y aceptan EXACTAMENTE (0,90] o [90,180) según su valor de ficha: ningún override ' +
      'guardado se cae del rango con la convención nueva (' +
      (malAceptados.length ? malAceptados.join(',') : 'ninguna discrepancia') + ')');
  }
}

// ================================================= D · EL ÁNGULO VIAJA AL DESPIECE
console.log('\nD — el ángulo efectivo es el que se factura (ang1..ang4)');
{
  // El CBS de la semilla es un 103B (dos α de 45°). Bajarle el primero a 30° tiene
  // que verse en ang1 del payload, sin tocar ang2 ni un solo kilo (las dims no
  // cambian: A y C son fijas y B ya estaba resuelta contra el mismo largo útil).
  const base = semilla();
  const mov = semilla(r => { r.componentes[0].angulos = [30, 45]; });
  const b0 = base.res.barras[0], b1 = mov.res.barras[0];
  ok(b1.ang1 === 30 && b1.ang2 === 45, 'CBS 103B con α1 = 30°: el payload lleva ang1 = 30, ang2 = 45');
  ok(b0.ang1 === 45, '…y sin tocar nada seguía siendo 45');
  ok(mov.res.resumen.items === 4 && mov.res.resumen.barras === 72,
    'sigue siendo el mismo despiece: 4 ítems y 72 barras');

  // Dos ángulos distintos = DOS barras distintas: la clave de agrupación incluye
  // ang1..ang4, así que el taller no puede recibir una sola etiqueta para dos
  // dobleces diferentes.
  const rec = S.semillaViga();
  const gemelo = JSON.parse(JSON.stringify(rec.componentes[0]));
  gemelo.comp_id = 'CBS_B'; gemelo.angulos = [30, 45];
  rec.componentes.push(gemelo);
  const res = G.generarViga(rec, {});
  ok(res.resumen.items === 5,
    'dos CBS iguales salvo el ángulo → 5 ítems, no 4 (el ángulo entra en la clave de la etiqueta)');
}

// ======================================= E · MEDIR Y DIBUJAR, EL MISMO ÁNGULO
console.log('\nE — con dims AUTO el ángulo cambia dims y trazo, y los dos van juntos');
{
  // Éste es el bloque que impide el defecto de fondo: que el 'auto' se resuelva con
  // el ángulo del catálogo mientras el trazador dibuja con el del componente. Se
  // comprueba sobre la geometría, no sobre un número congelado: la 105A tiene 5
  // tramos rectos sin gancho > 90°, o sea un SEGMENTO por tramo, así que el lado i
  // dibujado se puede comparar con su dim resuelta sin ninguna heurística.
  const TR = FP.tramosDeFigura('105A').tramos.map(t => t.lado);
  const segs = pts => segsRectos(pts).map(s => s.L);
  // La 105A no lista ángulos, así que se prueba con la 105B (lista uno, en el 1er
  // doblez) — misma topología de 5 tramos rectos.
  //
  // 18-AGO: con la convención de VÉRTICE, un α < 90 en la 105B es un gancho
  // REPLEGADO (recorrido 180 − α > 90°) y el trazo lo dibuja con el codo arqueado.
  // Por eso el conteo «un segmento por tramo» se hace sobre `segsRectos` (que
  // colapsa el codo) y no sobre puntos crudos, y por eso el lado que hace de CUERPO
  // del gancho sale retranqueado exactamente R = 2·φ + φ/2 = 4 cm con φ16: es la
  // REGLA DE LA CRESTA de `_ganchoFinal2D`, no una pérdida de precisión — el arco
  // toca la línea del vértice y la pata cuelga íntegra. Antes de la corrección el α
  // de la 105B era un quiebre suave, no llevaba codo, y los 5 lados salían clavados.
  const R_CODO = 4;
  const anteriores = [];
  [45, 70, 90].forEach(a => {
    const c = comp('105B', [a], null);
    const pl = expandir(c)[0];
    const s = segs(pl.puntos);
    const tramos = FP.tramosDeFigura('105B', [a]).tramos.map(t => t.lado);
    ok(s.length === tramos.length, '105B/α=' + a + ': un segmento por tramo (' + s.length + ')');
    // El cuerpo del gancho de la 105B es su lado B (el α gobierna el doblez A–B y la
    // pata es A, que cuelga completa). Sin codo (α = 90) no hay retranqueo.
    const retranq = (a === 90) ? {} : { B: R_CODO };
    tramos.forEach((L, i) => {
      // 20-AGO: la dim RESUELTA es hasta la CRESTA, asi que el trazo mide esa dim
      // menos el sobre del lado (mas el retranqueo del codo arqueado donde lo hay).
      const esp = pl.dims[L] - sobre('105B', L, 1.6, [a]) - (retranq[L] || 0);
      casi(s[i], esp, 0.01,
        '105B/α=' + a + ': el lado ' + L + ' DIBUJADO mide su dim RESUELTA menos el sobre de cresta' +
        (retranq[L] ? ' y el radio del codo' : '') + ' (' + esp.toFixed(2) + ')');
    });
    // Y el vértice DIBUJADO es el pedido: medir y dibujar salen del mismo número.
    casi(verticesDe(pl.puntos)[0], a, 1e-6,
      '105B/α=' + a + ': el VÉRTICE dibujado del primer doblez es el α declarado');
    ok(!(c._avisos || []).some(x => /FUERA/.test(x)),
      '105B/α=' + a + ': 0 fierro fuera del hormigón (el auto se resolvió con ESTE ángulo)');
    anteriores.push(JSON.stringify(pl.dims));
  });
  // 20-AGO · DOS JUEGOS, NO TRES, Y ES LA CONFIRMACION DEL CAMBIO. Con la medida
  // hasta la CRESTA el ángulo dejó de mover el largo de corte —«el ángulo de doblado
  // no mueve kilos», definición del usuario—: el B de la 105B da 592 en los tres
  // (la luz util exacta), porque el sobre del codo compensa justo lo que la reserva
  // de sobres le quitaba. Lo que SÍ cambia es la FORMA: con α = 90 el lado A deja de
  // ser una pata y pasa a cruzar la profundidad, 21 → 51. Entre 45 y 70 la diferencia
  // que quedaba era de milímetros y el redondeo al centímetro se la come.
  ok(new Set(anteriores).size === 2,
    'las dims responden a la FORMA (α = 90 saca A de pata: 21 → 51) y ya no al ángulo por sí mismo (=' +
    new Set(anteriores).size + ' juegos)');
}

// ================================ F · DONDE EL TRAZO NO LEE ÁNGULOS, SE DICE
console.log('\nF — el marco cerrado no lee ángulos: se avisa en vez de callarlo');
{
  ok(FP.trazoLeeAngulos('103C', 'cabezal') === true, '103C se traza como cadena → el α mueve el dibujo');
  ok(FP.trazoLeeAngulos('104D', 'estribo') === false,
    '104D se traza desde el MARCO (su gancho es el arco de norma) → el α no mueve el dibujo');
  ok(FP.trazoLeeAngulos('106A', 'estribo') === false, '106A tampoco (marco con ganchos declarados)');

  const per = pl => { let L = 0; for (let i = 1; i < pl.length; i++)
    L += Math.hypot(pl[i].x - pl[i-1].x, pl[i].y - pl[i-1].y, pl[i].z - pl[i-1].z); return L; };
  const p0 = semilla().res.placements.filter(p => p.figura === '104D')[0];
  const s1 = semilla(r => { r.componentes[2].angulos = [120, 120]; });
  const p1 = s1.res.placements.filter(p => p.figura === '104D')[0];
  casi(per(p1.puntos), per(p0.puntos), 1e-9,
    'ES 104D con α = 120°: el perímetro dibujado NO se mueve (el marco manda la forma)');
  const es = s1.res.barras.find(b => b.figura === '104D');
  ok(es.ang1 === 120 && es.ang2 === 120, '…pero el despiece SÍ lleva 120° (es el dato que se dobla)');
  ok((s1.receta.componentes[2]._avisos || []).some(a => a.indexOf('Ángulo del componente') === 0),
    '…y queda el aviso de que ahí el ángulo no mueve el trazo 3D');
  ok(s1.res.resumen.barras === 72, 'y el despiece sigue con sus 72 barras');
}

// ================================================== G · UNA SOLA CONVENCIÓN
console.log('\nG — el ángulo del catálogo es el del VÉRTICE (una sola convención)');
{
  // 1) LO QUE EL MOTOR HACE CON EL NÚMERO. El ángulo listado es el del VÉRTICE, y el
  //    trazador lo traduce a GIRO (= recorrido del doblado) con `_giroDeVertice`:
  //    giro = 180 − vértice. Este assert es el que congela la convención: si alguien
  //    volviera a meter el número de la ficha directo como giro, falla acá.
  //    LOS VALORES ESPERADOS SE INVIRTIERON EL 18-AGO respecto de la versión previa
  //    de este archivo (135→45 y 45→135). El número viejo describía la lectura
  //    contraria, la que dibujaba la 102B y la 102C intercambiadas; el dato del
  //    catálogo no cambió ni un dígito.
  const t104 = FP.tramosDeFigura('104D').tramos;
  ok(JSON.stringify(FP.mapaAngulosFigura('104D')) === '[0,2]',
    '104D: sus dos α gobiernan el 1er y el último doblez');
  ok(Number(t104[1].giro) === 45 && Number(t104[3].giro) === 45,
    '104D: el 135° de VÉRTICE del catálogo entra como GIRO de 45° (180 − 135)');
  const t103 = FP.tramosDeFigura('103C').tramos;
  ok(Number(t103[1].giro) === 135,
    '103C: el 45° de VÉRTICE del catálogo entra como giro de 135° (gancho replegado)');
  // Y al revés, sobre el trazo: el vértice DIBUJADO es el de la ficha. Es la
  // medición que motivó la corrección, hecha con producto punto sobre los tramos
  // rectos (`verticesDe`), no leyendo el modelo.
  {
    const D = { A: 20, B: 500, C: 20 };
    casi(verticesDe(expandir(comp('103C', null, D))[0].puntos)[0], 45, 1e-6,
      '103C: el vértice DIBUJADO mide los 45° de su ficha (antes medía 135°)');
    casi(verticesDe(expandir(comp('102B', null, { A: 20, B: 500 }))[0].puntos)[0], 135, 1e-6,
      '102B: el vértice DIBUJADO mide los 135° de su ficha (antes medía 45°)');
    casi(verticesDe(expandir(comp('102C', null, { A: 20, B: 500 }))[0].puntos)[0], 45, 1e-6,
      '102C: el vértice DIBUJADO mide los 45° de su ficha — 102B y 102C ya NO salen intercambiadas');
  }

  // 2) CUÁNTO COSTABA LA DIVERGENCIA. Con los ángulos invertidos (la convención
  //    vieja del Diseñador), 14 de las 63 figuras del catálogo CAMBIAN de
  //    constructor: un marco cerrado pasa a cadena abierta y al revés. No es un
  //    detalle de listado: es otra barra, con otro anclaje y otro reparto.
  const cods = CAT.codigos();
  const orig = {}; cods.forEach(c => { orig[c] = CAT.get(c).angulos.slice(); });
  const foto = () => cods.map(c => c + '|' + FP.familiaDeDibujo(c, 'estribo') + '|' +
    JSON.stringify(FP.paresEspejoFigura(c)));
  const a0 = foto();
  cods.forEach(c => { CAT.get(c).angulos = orig[c].map(v => 180 - v); });
  const a1 = foto();
  cods.forEach(c => { CAT.get(c).angulos = orig[c].slice(); });
  const dif = a0.filter((v, i) => v !== a1[i]).map(v => v.split('|')[0]);
  ok(dif.length === 14 && dif[0] === '104B' && dif.indexOf('104D') >= 0,
    'con la convención invertida 14 figuras cambian de constructor (104B…104U): ' + dif.join(','));
  ok(JSON.stringify(foto()) === JSON.stringify(a0), 'el catálogo queda restaurado tras la medición');

  // 3) EL ESCRITOR. El Diseñador de figuras es código de navegador (usa DOM/fetch) y
  //    no se puede cargar acá, así que se revisa su FUENTE: es el guard de que no
  //    vuelvan a convivir dos convenciones. Lo que importa es que lo que se GUARDA
  //    sea el ÁNGULO DEL VÉRTICE por los dos caminos (2D y 3D).
  //    18-AGO: estos tres asserts describían la convención contraria (guardar el
  //    recorrido). Se invierten, no se quitan: siguen siendo el guard, apuntando al
  //    otro lado.
  const src = fs.readFileSync(path.join(__dirname, '..', 'armahub', 'static', 'js',
    'features', 'catalogo', 'disenador.js'), 'utf8');
  ok(src.indexOf('_anguloInterno') < 0 && src.indexOf('_giroDesdeInterno') < 0,
    'disenador.js no tiene ni _anguloInterno ni _giroDesdeInterno: no queda ningún escritor del recorrido');
  ok(/function _verticeDesdeGiro\(giro\) \{ return 180 - \(Number\(giro\) \|\| 0\); \}/.test(src),
    'la traducción vértice ↔ recorrido vive en UNA sola función (_verticeDesdeGiro)');
  ok(/t\.giro !== 90 && t\.giro !== 0[\s\S]{0,240}_verticeDesdeGiro\(t\.giro\)/.test(src),
    'el guardado 2D filtra por el giro del tramo pero ESCRIBE el ángulo del vértice');
  ok(/disenador3dValoresAngulos\(\) : \[\]\);/.test(src) &&
     !/disenador3dValoresAngulos[\s\S]{0,80}\.map\(/.test(src),
    'el guardado 3D escribe TAL CUAL lo que mide el editor 3D (que ya es el vértice): sin conversión');
  // Y el rótulo de pantalla no puede desmentir al archivo: el α que muestra el panel
  // sale del mismo _verticeDesdeGiro que el que se guarda.
  ok(/var angulos = geo\.tramos\.filter\([\s\S]{0,80}_verticeDesdeGiro\(t\.giro\)/.test(src),
    'el panel rotula α con el MISMO número que se guarda (ángulo del vértice)');
  ok(/angulos\.filter\(function\(v\) \{ return v !== 90 && v !== 180; \}\)/.test(src),
    'y el filtro de "especiales" del rótulo es el de la lectura de vértice (≠90 y ≠180)');
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exitCode = fallos ? 1 : 0;
