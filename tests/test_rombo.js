// =============================================================================
// ROMBO DE SECCIÓN (106A) — EL MARCO MANDA LA FORMA (guard del fix 13-ago).
//
// Reporte del usuario: "destruiste al estribo" — un 106A como ES quedaba como
// mini-rombo de 9.6 por lado flotando al centro (todo su cuerpo es diagonal y
// la regla "diagonal en auto = gancho" lo dejaba sin ancla al marco). El fix:
// con rol estribo, sus 4 puntas van a los puntos MEDIOS de los 4 lados del
// marco de núcleo (vértices TEÓRICOS en el marco, convención del 104D/aSa; el
// redondeo del doblez lo pone el motor) y las dims se DERIVAN de esa geometría.
// Correr con: node tests/test_rombo.js
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
const viga = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const lim = (pl, e) => {
  const v = pl.puntos.map(p => p[e]);
  return { lo: Math.min(...v), hi: Math.max(...v) };
};
function es106(extra) {
  return Object.assign({
    tipologia: 'ES', figura: '106A', diam: 16, cara: 'lateral', angulos: [45, 45],
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' }, E: { modo: 'auto' }, F: { modo: 'auto' } },
    distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 20 }] }
  }, extra || {});
}

console.log('Clasificación:');
ok(FP.esRomboSeccion('106A') === true, '106A ES un rombo de sección');
ok(FP.esRomboSeccion('105A') === false, '105A (zigzag, no cierra) NO lo es');
ok(FP.esRomboSeccion('104D') === false, '104D (marco recto) NO lo es');
ok(FP.familiaDeDibujo('106A', 'estribo') === 'rombo', 'familia de dibujo = rombo');

console.log('106A φ16 todo auto en la viga 600×60×30 (recub 4/4/3):');
{
  const pls = R.expandirComponente(es106(), viga);
  ok(pls.length > 0, 'genera placements (' + pls.length + ')');
  const pl = pls[0], y = lim(pl, 'y'), z = lim(pl, 'z');
  // marco de núcleo (eje): y ±(30−4−0.8) = ±25.2 · z ±(15−3−0.8) = ±11.2 —
  // EXACTAMENTE la misma envolvente del 104D: las 4 puntas tocan el recub.
  ok(close(y.hi, 25.2) && close(y.lo, -25.2), 'puntas arriba/abajo AL marco: y ±25.2 (=' + y.hi + '/' + y.lo + ')');
  ok(close(z.hi, 11.2) && close(z.lo, -11.2), 'puntas laterales AL marco: z ±11.2 (=' + z.hi + '/' + z.lo + ')');
  // dims derivadas del marco EXTERIOR (24×52): lado = hypot(12,26) = 28.6 ·
  // ganchos terminales A/F = 6φ = 9.6. El listado dice lo que se dibuja.
  ok(close(pl.dims.B, 28.6, 0.05) && close(pl.dims.C, 28.6, 0.05) &&
     close(pl.dims.D, 28.6, 0.05) && close(pl.dims.E, 28.6, 0.05),
    'lados B..E = hypot(24/2, 52/2) = 28.6 (=' + pl.dims.B + ')');
  ok(close(pl.dims.A, 9.6, 0.05) && close(pl.dims.F, 9.6, 0.05),
    'ganchos A/F = 6φ = 9.6 (=' + pl.dims.A + ')');
}

console.log('Espejo y anidado:');
{
  const pe = R.expandirComponente(es106({ espejo: true }), viga)[0];
  const ye = lim(pe, 'y'), ze = lim(pe, 'z');
  ok(close(ye.hi, 25.2) && close(ze.hi, 11.2), 'espejada: misma envolvente (nada se corre)');
  const comp = es106({ distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: 3 } });
  const capas = R.expandirComponente(comp, viga);
  const c1 = capas.filter(p => p.meta.capa === 1)[0], c2 = capas.filter(p => p.meta.capa === 2)[0];
  ok(!!c1 && !!c2, '2 capas generan');
  ok(c2 && close(lim(c2, 'y').hi, lim(c1, 'y').hi - 3) && close(lim(c2, 'z').hi, lim(c1, 'z').hi - 3),
    'capa 2 = anillo CONCÉNTRICO 3 cm adentro (no una copia trasladada)');
}

console.log('El 104D no se movió (el estribo de siempre):');
{
  const pl = R.expandirComponente({
    tipologia: 'ES', figura: '104D', diam: 16, cara: 'lateral',
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 20 }] }
  }, viga)[0];
  ok(close(pl.dims.A, 24) && close(pl.dims.B, 52) &&
     close(lim(pl, 'y').hi, 25.2) && close(lim(pl, 'z').hi, 11.2),
    '104D: dims 24×52, envolvente ±25.2/±11.2 — byte-igual a siempre');
}

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos ? 1 : 0);
