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
  ok(close(z.hi, 6.7, 1e-6) && z.lo >= -6.7 - 1e-6,
    'la profundidad se ajusta al espesor útil: z ∈ [' + r2(z.lo) + ', ' + r2(z.hi) + '] ⊆ ±6.7');
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
