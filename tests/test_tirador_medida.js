// =============================================================================
// EL TIRADOR DEL MARCO ESCRIBE UNA MEDIDA, NO UN DESCUENTO — test headless (Node)
// =============================================================================
// EL DEFECTO QUE CONGELA (reportado y medido, 20-ago).
// El usuario armó estribos de confinamiento en un muro con ARREGLO POR ÁREA y
// achicó el estribo arrastrando el tirador del marco, para que envolviera un grupo
// de cabezales. Al achicar el muro después, el estribo PERDÍA su medida.
//
// Las POSICIONES ya seguían bien al hormigón (anclaje por distancia al borde,
// 18-ago): los estribos del borde se quedaban a 20 cm del testero a 600, 500, 400,
// 300 y 200. Lo que fallaba era la MEDIDA, y la causa era cómo se guardaba:
// arrastrar el tirador escribía un Δ — «tanto menos de lo que dé el hormigón», un
// ajuste RELATIVO. Al achicar el muro, la medida automática bajaba y el Δ seguía
// montado encima: el estribo se achicaba DOS VECES. MEDIDO: Δ −30 sobre un lado
// cuyo auto valía 13 dejaba el lado en −17 cm, y el motor emitía la barra igual.
//
// LA REGLA NUEVA: arrastrar el tirador significa «que mida esto». El gesto guarda
// la MEDIDA EFECTIVA (dims[L] = {modo:'fija', valor}) y esa medida manda el marco
// de la pieza de sección, que hasta ahora sólo obedecía al Δ.
//
// QUÉ PROTEGE, en orden:
//   A. EL CASO DEL USUARIO, entero: estribo en arreglo por área, achicado por
//      arrastre, y el muro que se achica después de 600 a 200 — la medida NO
//      cambia y las posiciones siguen al borde.
//   B. SE FIJA EL LADO ARRASTRADO Y SU ESPEJO, NUNCA LA PIEZA ENTERA: el par que
//      cruza el otro eje se queda en 'auto' y se reajusta con el hormigón.
//   C. EL CONTRASTE: guardado como Δ (lo de antes) el mismo estribo pierde la
//      medida y termina en negativo. Si alguien vuelve a escribir Δ desde el
//      tirador, el bloque A falla y éste dice por qué.
//   D. LADO ≤ 0: el motor lo AVISA (no hacía falta un aviso nuevo; hacía falta que
//      llegara a la pantalla, y eso vive en template_editor._actualizarStatus).
//   E. LA RÉPLICA DEL PAR ESPEJO COPIA EL CRECIMIENTO, NO EL NÚMERO: en la 106A
//      los dos lados del ancho tienen 'auto' distintos (19 y 24) y copiar el
//      número pedía dos marcos a la vez («el contorno no cierra»).
//
// Correr con: node tests/test_tirador_medida.js

'use strict';
const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const r4 = (v) => Math.round(Number(v) * 1e4) / 1e4;

// Muro de referencia del proyecto. El estribo va en el PLANO DE LA CARA (pose rumbo
// z): su ancho corre por el LARGO del muro —el eje que el usuario achicó— y su alto
// por la altura.
const MURO = { alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };
function host(largo, alto) {
  return { largo: largo, alto: (alto || MURO.alto), ancho: 20,
    recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };
}

// El estribo tal como queda DESPUÉS de arrastrarlo: el gesto dejó escrita la medida
// del lado que se agarró (A, el ancho) y la del alto (B), cada una con el borde por
// el que se cargó. Los pares espejo (C y D) NO se escriben: los replica el motor,
// que es donde vive esa regla desde que existe el Δ.
function estribo(dimA, dimB, fig) {
  const cerrada = (fig || '104D');
  const dims = (cerrada === '106A')
    ? { A: { modo: 'auto' }, B: { modo: 'auto' }, C: dimA || { modo: 'auto' },
        D: { modo: 'auto' }, E: { modo: 'auto' }, F: { modo: 'auto' } }
    : { A: dimA || { modo: 'auto' }, B: dimB || { modo: 'auto' },
        C: { modo: 'auto' }, D: { modo: 'auto' } };
  return {
    comp_id: 'EC1', tipologia: 'EC', figura: cerrada, diam: 8, cara: 'lateral', suf_tipo: '',
    jerarquia: 1, modo: 'arreglo', plano_pieza: { volteado: false },
    pose: { cara: 'sup', lado: 1, rumbo: 'z' }, dims: dims,
    arreglo: { n_capas: 1, sep_capas: 20, rango: null },
    distribucion: { modo: 'arreglo',
      rango:  { eje: 'x', from: -230, to: 230, sep: 120 },   // a lo largo del muro
      rango2: { eje: 'y', from: -60, to: 60, sep: 60 } }     // 2ª línea, en altura
  };
}
function receta(largo, comp) {
  return { tipo: 'muro', geometria: Object.assign({ largo: largo }, MURO), componentes: [comp] };
}
// Lo que hace el editor en cada regeneración: reanclar y expandir.
function correr(rec, largo) {
  rec.geometria.largo = largo;
  R.reanclarReceta(rec);
  const c = rec.componentes[0];
  delete c._avisos;                       // los avisos son de ESTA pasada
  const pls = R.expandirComponente(c, host(largo));
  const uno = pls[0].puntos.map(q => q.x);
  let mn = Infinity, mx = -Infinity;
  pls.forEach(p => p.puntos.forEach(q => { if (q.x < mn) mn = q.x; if (q.x > mx) mx = q.x; }));
  return {
    n: pls.length, dims: pls[0].dims,
    ancho: r4(Math.max.apply(null, uno) - Math.min.apply(null, uno)),   // lo que MIDE un estribo
    borde: [r4(mn + largo / 2), r4(largo / 2 - mx)],                    // gap al testero, los dos
    avisos: c._avisos || []
  };
}

// ======================================================= A · EL CASO DEL USUARIO
console.log('A — estribo achicado por arrastre: la medida no la mueve el hormigón');
{
  const rec = receta(600, estribo({ modo: 'fija', valor: 100, extremo: 'fin' },
                                  { modo: 'fija', valor: 60, extremo: 'ini' }));
  R.normalizarReceta(rec);
  R.reanclarReceta(rec);
  const medidas = [], bordes = [], anchos = [];
  [600, 500, 400, 300, 200].forEach(L => {
    const r = correr(rec, L);
    medidas.push(Number(r.dims.A) + '/' + Number(r.dims.C));
    anchos.push(r.ancho);
    bordes.push(r.borde[0] + '|' + r.borde[1]);
    ok(r.avisos.length === 0, 'muro ' + L + ': sin avisos (=' + JSON.stringify(r.avisos) + ')');
  });
  ok(medidas.every(m => m === '100/100'),
    'a 600/500/400/300/200 el estribo sigue midiendo 100, y su espejo también (=' +
    JSON.stringify(medidas) + ')');
  ok(anchos.every(a => a === 99.2),
    '…y el estribo DIBUJADO tampoco se mueve: 99.2 de eje a eje (100 − φ) en los cinco (=' +
    JSON.stringify(anchos) + ')');
  // Lo que YA funcionaba y no se puede romper: la cortina anclada al testero.
  ok(bordes.every(b => b === '20.4|20.4'),
    'y las posiciones siguen al hormigón: los dos estribos del borde a 20.4 cm del ' +
    'testero en los cinco largos (=' + JSON.stringify(bordes) + ')');
}

// =========================================== B · SÓLO EL LADO ARRASTRADO Y SU PAR
console.log('\nB — se fija el lado arrastrado y su espejo, nunca la pieza entera');
{
  // Un solo arrastre: el ANCHO queda escrito y el ALTO sigue en 'auto', así que se
  // reajusta con los recubrimientos si el muro engorda o adelgaza. Si el gesto
  // fijara la pieza entera, el alto se quedaría clavado en 245 con el muro en 300.
  const c250 = estribo({ modo: 'fija', valor: 100, extremo: 'fin' });
  const p250 = R.expandirComponente(c250, host(600, 250));
  const c300 = estribo({ modo: 'fija', valor: 100, extremo: 'fin' });
  const p300 = R.expandirComponente(c300, host(600, 300));
  ok(Number(p250[0].dims.A) === 100 && Number(p300[0].dims.A) === 100,
    'el lado arrastrado mide 100 con el muro de 250 y con el de 300');
  ok(Number(p250[0].dims.B) === 245 && Number(p300[0].dims.B) === 295,
    'el par perpendicular sigue en AUTO y acompaña al hormigón: 245 → 295 (=' +
    p250[0].dims.B + ' → ' + p300[0].dims.B + ')');
}

// ==================================================== C · EL CONTRASTE (LO VIEJO)
console.log('\nC — guardado como Δ (lo de antes) la medida se pierde');
{
  // El MISMO gesto expresado como Δ: −480 sobre un lado que en el muro de 600 vale
  // 595. A 600 da 115… y a 400 y 200 el auto baja y el Δ sigue montado encima.
  const rec = receta(600, estribo({ modo: 'auto', delta: -480, extremo: 'fin' }));
  R.normalizarReceta(rec);
  R.reanclarReceta(rec);
  const v600 = correr(rec, 600).dims.A;
  const v400 = correr(rec, 400).dims.A;
  const r200 = correr(rec, 200);
  ok(Number(v600) === 115 && Number(v400) === -85 && Number(r200.dims.A) === -285,
    'con Δ el lado va 115 → −85 → −285 al achicar el muro: se achica dos veces (=' +
    v600 + '/' + v400 + '/' + r200.dims.A + ')');
  ok(r200.avisos.some(a => /lado A/.test(a) && /no es construible/.test(a)),
    '…y el motor lo dice, aunque genere la barra igual (=' +
    JSON.stringify(r200.avisos.filter(a => /lado A/.test(a))) + ')');
}

// ============================================== D · UN LADO ≤ 0 NO ES UNA BARRA
console.log('\nD — un lado en cero o negativo se avisa, venga del Δ o de la medida');
{
  // El aviso universal del lado ≤ 0 ya existía en el motor (15-ago) y cubre las dos
  // rutas. Lo que faltaba estaba en la PANTALLA: el mensaje del arrastre reemplazaba
  // la línea de estado entera —avisos incluidos—, así que durante todo el gesto el
  // usuario no veía el aviso rojo (fix en template_editor._actualizarStatus).
  [0, -17].forEach(v => {
    const c = estribo({ modo: 'fija', valor: v, extremo: 'fin' });
    R.expandirComponente(c, host(600));
    const av = (c._avisos || []).filter(a => /lado A/.test(a));
    ok(av.length === 1 && /no es construible/.test(av[0]),
      'medida ' + v + ' cm: UN aviso, no dos (=' + JSON.stringify(av) + ')');
  });
}

// ================================ E · LA RÉPLICA DEL ESPEJO COPIA EL CRECIMIENTO
console.log('\nE — el par espejo hereda el crecimiento, no el número');
{
  // En la 104D los dos lados del ancho miden lo mismo en 'auto' y da igual copiar
  // una cosa o la otra. En la 106A no: el ancho lo miden C y E y sus 'auto' valen
  // 19 y 24 (uno está recortado por el gancho). Copiando el NÚMERO, fijar C dejaba
  // a los dos pidiendo marcos distintos y el motor cantaba «el contorno no cierra».
  const c = estribo({ modo: 'fija', valor: 80, extremo: 'fin' }, null, '106A');
  const pls = R.expandirComponente(c, host(600));
  ok(!(c._avisos || []).some(a => /no cierra/.test(a)),
    'arrastrar UN lado de la 106A no deja el contorno abierto (=' +
    JSON.stringify(c._avisos) + ')');
  ok(Number(pls[0].dims.C) === 80 && Number(pls[0].dims.E) === 80,
    'C y E salen a 80 (el mismo crecimiento sobre sus autos) (=' +
    pls[0].dims.C + '/' + pls[0].dims.E + ')');
}

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
