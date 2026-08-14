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
//   UNA SOLA CONVENCIÓN — el ángulo ES el GIRO (cuánto se desvía la barra de seguir
//   recta), que es lo que ya usaban el seed del catálogo y el trazador. El Diseñador
//   de figuras guardaba el SUPLEMENTARIO (180 − giro) y eso hacía que una figura
//   dibujada quedara con el valor invertido respecto de una sembrada.
//
// QUÉ PROTEGE, en orden:
//   A. SIN override = comportamiento de hoy, byte por byte (viga-semilla
//      {items:4, barras:72, kg:136.1} y sus 4 ítems con sus ángulos).
//   B. CONGELA EL ÁNGULO POR BARRA: con dims FIJAS, mover el ángulo mueve la punta
//      del gancho y NO mueve ni una dim ni el largo de la polilínea.
//   C. RANGO: fuera del rango de su doblez se ignora, cae al catálogo y avisa.
//   D. EL ÁNGULO VIAJA AL DESPIECE (ang1..ang4) y agrupa como barra distinta.
//   E. MEDIR = DIBUJAR: con dims 'auto' el ángulo cambia las dims Y el trazo, y los
//      dos salen del MISMO número (el lado dibujado mide su dim resuelta).
//   F. DONDE EL TRAZO NO LEE ÁNGULOS (marco cerrado / traba clásica) se AVISA en vez
//      de dejar al usuario moviendo un control mudo.
//   G. CONVENCIÓN ÚNICA: el ángulo del catálogo ES el giro que aplica el trazador, y
//      el escritor del Diseñador ya no guarda el suplementario.
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
function semilla(mut) {
  const rec = S.semillaViga();
  if (mut) mut(rec);
  return { receta: rec, res: G.generarViga(rec, {}) };
}

// ============================================== A · SIN OVERRIDE = HOY, BYTE A BYTE
console.log('A — sin override efectivo el motor da EXACTAMENTE lo de siempre');
{
  const { res } = semilla();
  ok(res.resumen.items === 4 && res.resumen.barras === 72 && res.resumen.kg === 136.1,
    'viga-semilla en {items:4, barras:72, kg:136.1} — la referencia viva');
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
  // dice que gobierna el PRIMER doblez. Los dos dobleces quedan ≤ 90°, así que el
  // trazo NO lleva arcos (`_conGanchosRadio` sólo actúa sobre dobleces > 90°) y la
  // polilínea es la cadena de vértices: su largo es la suma de las dims, EXACTA.
  ok(JSON.stringify(FP.mapaAngulosFigura('103C')) === '[0]',
    '103C: su único α gobierna el primer doblez (mapa leído del catálogo, no inventado)');
  const DIMS = { A: 20, B: 500, C: 20 };
  const base = expandir(comp('103C', null, DIMS))[0];
  const L0 = largoPoli(base.puntos);
  casi(L0, 540, 1e-9, 'con el ángulo del catálogo la polilínea mide A+B+C = 540 cm');

  let puntas = [];
  [10, 30, 45, 60, 90].forEach(a => {
    const pl = expandir(comp('103C', [a], DIMS))[0];
    casi(largoPoli(pl.puntos), 540, 1e-9, 'α1 = ' + a + '°: la polilínea sigue midiendo 540 cm');
    ok(JSON.stringify(pl.dims) === JSON.stringify(base.dims),
      'α1 = ' + a + '°: las dims no se mueven (' + JSON.stringify(pl.dims) + ')');
    puntas.push(pl.puntos[0].x.toFixed(4) + ',' + pl.puntos[0].y.toFixed(4));
  });
  ok(new Set(puntas).size === 5,
    'las 5 posiciones de la PUNTA del gancho son distintas: ' + JSON.stringify(puntas));

  // Y la geometría es la del doblez, no una aproximación: la pata A de 20 cm sale
  // del vértice a exactamente α grados del cuerpo.
  [30, 60].forEach(a => {
    const p = expandir(comp('103C', [a], DIMS))[0].puntos;
    const dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;       // pata A (punta → vértice)
    const dbx = p[2].x - p[1].x, dby = p[2].y - p[1].y;     // cuerpo B
    const giro = Math.acos((dx * dbx + dy * dby) / (Math.hypot(dx, dy) * Math.hypot(dbx, dby)));
    casi(giro * 180 / Math.PI, a, 1e-6, 'α1 = ' + a + '°: el doblez REAL entre A y B mide ' + a + '°');
    casi(Math.hypot(dx, dy), 20, 1e-9, '…y la pata A sigue midiendo sus 20 cm');
  });

  // GANCHO > 90° (102B, catálogo 135°): acá el trazo SÍ lleva arco explícito, y el
  // arco de un doblez más cerrado es más corto — eso es física del doblado, no un
  // error. Lo que NO puede moverse es el dato que se corta: las dims y el largo del
  // despiece, que salen de la suma de lados.
  {
    const d2 = { A: 20, B: 500 };
    const a0 = expandir(comp('102B', null, d2))[0];
    const a1 = expandir(comp('102B', [110], d2))[0];
    ok(JSON.stringify(a0.dims) === JSON.stringify(a1.dims),
      '102B: bajar el gancho de 135° a 110° no toca las dims (' + JSON.stringify(a1.dims) + ')');
    ok(Math.abs(a1.puntos[0].x - a0.puntos[0].x) > 1,
      '…pero la punta del gancho se mueve (' + a0.puntos[0].x.toFixed(2) + ' → ' + a1.puntos[0].x.toFixed(2) + ')');
    ok(largoPoli(a1.puntos) < largoPoli(a0.puntos),
      '…y la polilínea DIBUJADA es un poco más corta porque el arco del codo barre menos: ' +
      largoPoli(a0.puntos).toFixed(4) + ' → ' + largoPoli(a1.puntos).toFixed(4));
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
  const segs = pts => {
    const o = [];
    for (let i = 1; i < pts.length; i++) {
      o.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
    }
    return o;
  };
  // La 105A no lista ángulos, así que se prueba con la 105B (lista uno, en el 1er
  // doblez) — misma topología de 5 tramos rectos.
  const anteriores = [];
  [45, 70, 90].forEach(a => {
    const c = comp('105B', [a], null);
    const pl = expandir(c)[0];
    const s = segs(pl.puntos);
    const tramos = FP.tramosDeFigura('105B', [a]).tramos.map(t => t.lado);
    ok(s.length === tramos.length, '105B/α=' + a + ': un segmento por tramo (' + s.length + ')');
    tramos.forEach((L, i) => {
      casi(s[i], pl.dims[L], 0.01,
        '105B/α=' + a + ': el lado ' + L + ' DIBUJADO mide su dim RESUELTA (' + pl.dims[L].toFixed(2) + ')');
    });
    ok(!(c._avisos || []).some(x => /FUERA/.test(x)),
      '105B/α=' + a + ': 0 fierro fuera del hormigón (el auto se resolvió con ESTE ángulo)');
    anteriores.push(JSON.stringify(pl.dims));
  });
  ok(new Set(anteriores).size === 3,
    'y las dims resueltas son distintas en los 3 ángulos: el auto respondió a la figura real');
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
console.log('\nG — el ángulo del catálogo ES el giro (una sola convención)');
{
  // 1) LO QUE EL MOTOR HACE CON EL NÚMERO. El trazador aplica el ángulo listado como
  //    GIRO del doblez que le toca. Si alguien volviera a guardar el suplementario,
  //    esto falla en el primer assert.
  const t104 = FP.tramosDeFigura('104D').tramos;
  ok(JSON.stringify(FP.mapaAngulosFigura('104D')) === '[0,2]',
    '104D: sus dos α gobiernan el 1er y el último doblez');
  ok(Number(t104[1].giro) === 135 && Number(t104[3].giro) === 135,
    '104D: el 135° del catálogo entra como GIRO de 135° (el gancho sísmico), no como su suplemento');
  const t103 = FP.tramosDeFigura('103C').tramos;
  ok(Number(t103[1].giro) === 45, '103C: el 45° del catálogo entra como giro de 45° (quiebre)');

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
  //    vuelvan a convivir dos convenciones. Lo que importa es que el suplementario ya
  //    no se use al GUARDAR — sólo para traducir la medición interna del editor 3D.
  const src = fs.readFileSync(path.join(__dirname, '..', 'armahub', 'static', 'js',
    'features', 'catalogo', 'disenador.js'), 'utf8');
  ok(src.indexOf('_anguloInterno') < 0,
    'disenador.js ya no tiene _anguloInterno: no queda ningún escritor del suplementario');
  ok(/t\.giro !== 90 && t\.giro !== 0[\s\S]{0,120}Number\(t\.giro\)/.test(src),
    'el guardado 2D escribe el GIRO de cada doblez especial');
  ok(/disenador3dValoresAngulos\(\) : \[\]\)\s*\n\s*\.map\(_giroDesdeInterno\)/.test(src),
    'el guardado 3D convierte la medición interna a GIRO antes de guardar');
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exitCode = fallos ? 1 : 0;
