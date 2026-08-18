// =============================================================================
// BATERÍA DEL MURO — AUTO UNIVERSAL POR DIRECCIÓN-EN-POSE (feedback 13-ago).
//
// La viga tiene su barrido (test_pose); el muro no tenía NINGUNO y por eso sus
// defectos llegaron al usuario. Esto congela la regla de raíz:
//   · un lado en 'auto' se resuelve contra LO QUE SU DIRECCIÓN CRUZA en la pose:
//     ⊥ al dominante → profundidad útil EJE A EJE (espesor − recubs − φ, la
//     fórmula del estribo) · diagonal → gancho normativo · a lo largo → largo
//     útil − sobres − φ/2 por extremo CON doblez (cresta en línea con el recub).
//   · las piezas de sección (EC marco / TC cadena) encuadran su marco con recub
//     EXACTO por las dos caras.
// Muro canónico 400×250×20, recub caras 2.5 / bordes 3 (el del usuario).
// Correr con: node tests/test_muro_auto.js
// =============================================================================

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
const FP = global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-6); }
const r2 = v => Math.round(v * 100) / 100;

const muro = { largo: 400, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };
const lim = (pl, e) => {
  const v = pl.puntos.map(p => p[e]);
  return { lo: Math.min(...v), hi: Math.max(...v) };
};
function unaPieza(comp) {
  const pls = R.expandirComponente(comp, muro);
  return pls.length ? pls[0] : null;
}
const distY = { modo: 'linear', rango: { eje: 'y', from: -122, to: 122, sep: 20 } };
const autoDims = lados => Object.fromEntries(lados.map(L => [L, { modo: 'auto' }]));

console.log('MH 104B φ16 TODO AUTO (el caso reportado por el usuario):');
{
  const pl = unaPieza({
    tipologia: 'MH', figura: '104B', diam: 16, cara: 'lateral', angulos: [45, 45],
    pose: { cara: 'lateral', lado: 1, rumbo: 'x' },
    dims: autoDims(['A', 'B', 'C', 'D']), distribucion: distY
  });
  ok(!!pl, 'genera placement');
  const z = lim(pl, 'z'), x = lim(pl, 'x');
  // núcleo eje a eje en el espesor: ±(10 − 2.5 − 0.8) = ±6.7 → recub 2.5 EXACTO
  // por las DOS caras (antes: profundidad 16.4 en un núcleo de 14.2, 0.49 FUERA
  // del hormigón por la cara opuesta).
  // 18-AGO · el CUERPO sigue cerrando contra el núcleo (z.hi = 6.7); lo que se pasa
  // 0.216652 es la PUNTA del gancho A, que en 'auto' vale el 6φ normativo y con la
  // convención de VÉRTICE queda replegado colgando de la salida del arco. Explicado
  // en detalle en el bloque de la 103C, más abajo (mismo número exacto). El fierro
  // sigue DENTRO del hormigón: cara del fierro en −7.72 contra la del muro en −10.
  ok(close(z.hi, 6.7, 1e-6) && close(z.lo, -6.916652224137049, 1e-9),
    'la profundidad se ajusta al espesor útil: z ∈ [' + r2(z.lo) + ', ' + r2(z.hi) +
    '] (cuerpo en 6.7, punta del gancho replegado en −6.916652)');
  // largo: eje del doblez a recub_borde + φ/2 → ±196.2 (la CRESTA del doblez en
  // línea con el recub; antes el eje llegaba a ±197 y la superficie lo invadía).
  ok(close(x.hi, 196.2, 1e-6) && close(x.lo, -196.2, 1e-6),
    'el doblez del extremo queda a recub + φ/2: x = ±' + r2(x.hi));
}

console.log('MH 103A φ16 (patas de 90°) TODO AUTO — el clásico también obedece:');
{
  const pl = unaPieza({
    tipologia: 'MH', figura: '103A', diam: 16, cara: 'lateral',
    pose: { cara: 'lateral', lado: 1, rumbo: 'x' },
    dims: autoDims(['A', 'B', 'C']), distribucion: distY
  });
  ok(!!pl, 'genera placement');
  const z = lim(pl, 'z');
  ok(close(z.hi, 6.7, 1e-6) && close(z.lo, -6.7, 1e-6),
    'las patas ⊥ en auto cruzan EXACTO el espesor útil: z = [' + r2(z.lo) + ', ' + r2(z.hi) + '] (= ±6.7)');
  ok(close(pl.dims.A, 13.4, 1e-6) && close(pl.dims.C, 13.4, 1e-6),
    'A = C = espesor útil eje a eje = 15 − φ = 13.4 (la fórmula universal) (=' + r2(pl.dims.A) + ')');
}

// GUARDA DE LA MIGRACIÓN CABEZAL → TRAZADOR (bug reportado por el usuario: «una
// 103C se dibuja idéntica a una 103A, sin su gancho»). La 103C declara UN solo
// ángulo (45°) en el catálogo: su pata inicial es DIAGONAL y la final sigue a 90°.
// El constructor de cabezal dibujaba las dos a 90° fijas, así que en el muro salía
// byte-idéntica a la 103A de arriba — misma figura para dos códigos distintos, y
// sin un solo aviso. Ahora cada pata obedece a SU dirección en la pose:
//   A diagonal ('d') → gancho normativo 6φ = 9.6, trazado a 45°
//   C ⊥ al dominante ('v') → cruza el espesor útil eje a eje = 13.4, a 90°
// La figura queda ASIMÉTRICA, que es lo que el código dice que es.
console.log('MH 103C φ16 (un solo gancho a 45°) — YA NO se dibuja como una 103A:');
{
  const p103A = unaPieza({
    tipologia: 'MH', figura: '103A', diam: 16, cara: 'lateral',
    pose: { cara: 'lateral', lado: 1, rumbo: 'x' },
    dims: autoDims(['A', 'B', 'C']), distribucion: distY
  });
  const pl = unaPieza({
    tipologia: 'MH', figura: '103C', diam: 16, cara: 'lateral',
    pose: { cara: 'lateral', lado: 1, rumbo: 'x' },
    dims: autoDims(['A', 'B', 'C']), distribucion: distY
  });
  ok(!!pl, 'genera placement');
  const mismo = pl.puntos.length === p103A.puntos.length && pl.puntos.every((p, i) =>
    close(p.x, p103A.puntos[i].x) && close(p.y, p103A.puntos[i].y) && close(p.z, p103A.puntos[i].z));
  ok(!mismo, 'su polilínea NO coincide con la de la 103A (el bug reportado)');
  ok(close(pl.dims.A, 9.6, 1e-6) && close(pl.dims.C, 13.4, 1e-6),
    'A (diagonal) = gancho 9.6 y C (⊥) = espesor útil 13.4: cada pata según SU dirección (=' +
    r2(pl.dims.A) + ' / ' + r2(pl.dims.C) + ')');
  // ÁNGULO DEL VÉRTICE de cada doblez (18-ago: es el número que declara el catálogo).
  // Se mide sobre los tramos RECTOS: con la convención de vértice el 45° de la 103C
  // es un gancho REPLEGADO (135° de recorrido) y ese doblez lo dibuja el codo
  // arqueado, así que puntos[0..3] caen dentro del muestreo del arco y medir entre
  // puntos consecutivos daba el paso del muestreo (4.5° / 9°), no la figura.
  const vertices = pts => {
    const RC = 4, s = [];                                   // radio del codo con φ16
    for (let i = 1; i < pts.length; i++) {
      const d = { x: pts[i].x - pts[i-1].x, y: pts[i].y - pts[i-1].y, z: pts[i].z - pts[i-1].z };
      const L = Math.hypot(d.x, d.y, d.z);
      if (!(L > 1e-9)) continue;
      if (pts[i-1].esArco && pts[i].esArco && L < RC) continue;
      s.push({ d, L });
    }
    const o = [];
    for (let i = 1; i < s.length; i++) {
      const a = s[i-1], b = s[i];
      const c = (a.d.x*b.d.x + a.d.y*b.d.y + a.d.z*b.d.z) / (a.L*b.L);
      o.push(Math.acos(Math.max(-1, Math.min(1, -c))) * 180 / Math.PI);
    }
    return o;
  };
  const vv = vertices(pl.puntos);
  ok(vv.length === 2 && close(vv[0], 45, 1e-6) && close(vv[1], 90, 1e-6),
    'y los VÉRTICES DIBUJADOS son 45° / 90°, los del catálogo (=' +
    vv.map(v => r2(v)).join('° / ') + '°)');
  const x = lim(pl, 'x'), z = lim(pl, 'z');
  ok(close(x.hi, 196.2, 1e-6) && close(x.lo, -196.2, 1e-6),
    'sigue cerrando contra el recub de borde por los dos extremos (x = ±196.2)');
  // 18-AGO · z.lo pasa de −6.7 a −6.916652 y hay que decir POR QUÉ, porque es una
  // pérdida de recubrimiento (0.2167 cm en esa cara) y no un redondeo:
  //   · el lado A es DIAGONAL ('d'), o sea su 'auto' es el GANCHO NORMATIVO 6φ = 9.6
  //     y no se negocia contra el espesor (la misma regla que documenta el bloque
  //     del 105F en tests/test_fuera_hormigon.js);
  //   · con la convención de VÉRTICE ese gancho pasa a ser REPLEGADO (135° de
  //     recorrido), lo dibuja `_ganchoFinal2D` y la pata cuelga COMPLETA desde la
  //     SALIDA DEL ARCO — que está desplazada R respecto de la cadena de vértices.
  //     Salida del arco en z = −0.128427, más 9.6·sin45 = 6.788225 → −6.916652.
  // El fierro SIGUE DENTRO DEL HORMIGÓN con holgura (la cara del fierro queda en
  // −7.72 contra la cara del muro en −10), que es lo que este assert protegía; lo
  // que se estrecha es el recubrimiento nominal de esa cara. Se congela el número
  // EXACTO en vez de una cota floja para que cualquier movimiento futuro se vea.
  ok(close(z.hi, 6.7, 1e-6) && close(z.lo, -6.916652224137049, 1e-9),
    'el cuerpo cierra contra el núcleo (z.hi = 6.7) y la punta del gancho replegado ' +
    'llega a −6.916652 (=' + r2(z.lo) + ', ' + r2(z.hi) + ')');
  ok(Math.abs(z.lo) + 1.6 / 2 <= muro.ancho / 2 - 1e-9 && Math.abs(z.hi) + 1.6 / 2 <= muro.ancho / 2,
    '…y no saca fierro por el espesor: la cara del fierro queda en ' +
    r2(Math.abs(z.lo) + 0.8) + ' ⊆ ' + (muro.ancho / 2));
}

console.log('MH 103B φ16 (patas 45°) TODO AUTO — la diagonal sigue al gancho:');
{
  const pl = unaPieza({
    tipologia: 'MH', figura: '103B', diam: 16, cara: 'lateral', angulos: [45, 45],
    pose: { cara: 'lateral', lado: 1, rumbo: 'x' },
    dims: autoDims(['A', 'B', 'C']), distribucion: distY
  });
  ok(!!pl, 'genera placement');
  ok(close(pl.dims.A, 9.6, 1e-6), 'pata diagonal en auto = gancho normativo 6φ = 9.6 (=' + r2(pl.dims.A) + ')');
}

console.log('EC 104D φ8 TODO AUTO — el estribo del muro encuadra su marco:');
{
  const pl = unaPieza({
    tipologia: 'EC', figura: '104D', diam: 8, cara: 'lateral',
    pose: { cara: 'lateral', lado: 1, rumbo: 'y' },
    dims: autoDims(['A', 'B', 'C', 'D']), distribucion: distY
  });
  ok(!!pl, 'genera placement');
  const z = lim(pl, 'z'), x = lim(pl, 'x');
  ok(close(z.hi, 7.1, 1e-6) && close(z.lo, -7.1, 1e-6),
    'marco al espesor: z = ±7.1 (recub caras 2.5 exacto) (=' + r2(z.hi) + ')');
  ok(close(x.hi, 196.6, 1e-6) && close(x.lo, -196.6, 1e-6),
    'marco al largo: x = ±196.6 (recub bordes 3 exacto) (=' + r2(x.hi) + ')');
  ok(close(pl.dims.A, 15, 1e-6) || close(pl.dims.B, 15, 1e-6),
    'la dim del espesor lista 15 EXTERIOR (20 − 2·2.5), como el estribo de viga');
}

console.log('TC 104B φ8 TODO AUTO — la amarra cruza el espesor (pose nueva):');
{
  const pl = unaPieza({
    tipologia: 'TC', figura: '104B', diam: 8, cara: 'lateral', angulos: [45, 45],
    pose: { cara: 'lateral', lado: 1, rumbo: 'y' },
    dims: autoDims(['A', 'B', 'C', 'D']), distribucion: distY
  });
  ok(!!pl, 'genera placement');
  const z = lim(pl, 'z');
  ok(close(z.hi, 7.1, 1e-6) && close(z.lo, -7.1, 1e-6),
    'cuerpo al espesor útil: z = ±7.1, recub 2.5 por las dos caras (=' + r2(z.hi) + ')');
  ok(pl.dims.A < 20, 'las dims salen del espesor, no del alto (regresión 244×4) (A=' + r2(pl.dims.A) + ')');
}

console.log('Barrido MH/MV × figuras × capas — nada saca fierro del hormigón:');
{
  const figs = [
    { f: '103A', ang: [] }, { f: '103B', ang: [45, 45] },
    { f: '104B', ang: [45, 45] }, { f: '102A', ang: [] }
  ];
  const poses = {
    MH: { cara: 'lateral', lado: 1, rumbo: 'x' },
    MV: { cara: 'lateral', lado: 1, rumbo: 'y' }
  };
  let n = 0; const fuera = [];
  ['MH', 'MV'].forEach(tip => figs.forEach(fg => [1, 2].forEach(capas => {
    const spec = global.ModeladorCatalogoFiguras.get(fg.f);
    const comp = {
      tipologia: tip, figura: fg.f, diam: 16, cara: 'lateral', angulos: fg.ang,
      pose: poses[tip], dims: autoDims(spec.parciales),
      distribucion: { modo: 'layered', n_capas: capas, barras_capa: 1, gap: 2 }
    };
    R.expandirComponente(comp, muro).forEach(pl => {
      n++;
      const x = lim(pl, 'x'), y = lim(pl, 'y'), z = lim(pl, 'z');
      const s = Math.max(0, x.hi - 200, -200 - x.lo, y.hi - 125, -125 - y.lo,
        z.hi + 0.8 - 10, -10 - (z.lo - 0.8));   // z a la CARA del fierro (φ16)
      if (s > 1e-6) fuera.push(tip + '/' + fg.f + '×' + capas + ' (+' + r2(s) + ')');
    });
  })));
  ok(fuera.length === 0, n + ' piezas y 0 con fierro fuera del hormigón' +
    (fuera.length ? ' — ' + fuera.join(' · ') : ''));
}

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos ? 1 : 0);
