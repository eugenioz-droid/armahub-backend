// =============================================================================
// 106A = ESTRIBO RECTANGULAR CON GANCHOS DECLARADOS (corrección 14-ago).
//
// Historia del archivo, para que no se repita: el 13-ago la 106A se clasificó
// mal como "rombo" — su trazado derivado parte con el gancho de 45° y eso
// INCLINA el cuerpo en el sistema del trazo, así que el rectángulo salía
// "diagonal" — y este test congeló esa figura inventada. El usuario lo aclaró:
// «la 106A NUNCA fue un rombo; no hemos incorporado figuras tipo rombo». La
// 106A es el estribo de siempre: 104D lo describe con 4 letras (ganchos
// implícitos) y 106A con 6 (ganchos A y F declarados como parciales). Se
// dibuja con _estriboPerimetral — EL MARCO MANDA — que es como estaba bien en
// las vigas antes de la Tanda P.
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
const r2 = v => Math.round(v * 100) / 100;
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
ok(FP.esEstriboConGanchos('106A') === true, '106A ES un estribo con ganchos declarados');
ok(FP.esEstriboConGanchos('104D') === false, '104D no lo necesita (sus ganchos son implícitos)');
ok(FP.esEstriboConGanchos('105A') === false, '105A (zigzag) NO lo es');
ok(FP.esEstriboConGanchos('104B') === false, '104B (cadena abierta de 4) NO lo es');
// (15-ago) `esRomboSeccion` se RETIRÓ: era un `return false` literal y el único
// productor de la familia 'rombo', así que nada podía verla. El guard equivalente
// —y más fuerte— es que la 106A se clasifica como ESTRIBO, que es lo que se
// verifica arriba y abajo en este mismo archivo.
ok(FP.familiaDeDibujo('106A', null) === 'estribo', 'y el "rombo" quedó MUERTO: la 106A es un estribo');
ok(FP.familiaDeDibujo('106A', 'estribo') === 'estribo', 'familia de dibujo = ESTRIBO (el marco manda)');
ok(FP.familiaDeDibujo('106A', null) === 'estribo', 'también sin rol (fuerza pieza de sección por topología)');

console.log('106A φ16 todo auto en la viga 600×60×30 (recub 4/4/3):');
{
  const pls = R.expandirComponente(es106(), viga);
  ok(pls.length > 0, 'genera placements (' + pls.length + ')');
  const pl = pls[0], y = lim(pl, 'y'), z = lim(pl, 'z');
  // El MISMO marco del 104D: eje a recub + φ/2 → y ±25.2 · z ±11.2. Ganchos del
  // marco (patas al núcleo) incluidos: nada asoma del hormigón.
  ok(close(y.hi, 25.2) && close(y.lo, -25.2), 'marco al alto: y ±25.2 (=' + r2(y.hi) + '/' + r2(y.lo) + ')');
  ok(close(z.hi, 11.2) && close(z.lo, -11.2), 'marco al ancho: z ±11.2 (=' + r2(z.hi) + '/' + r2(z.lo) + ')');
  // Dims listadas = lo que el marco dibuja (exterior, como el 104D); cuerpo B..E en
  // orden de recorrido alto/ancho/alto/ancho.
  // 20-AGO: la pata pasó a 10φ y la dim la mide HASTA LA CRESTA, o sea la extensión
  // libre MÁS su doblez (10φ + R + φ = 16 + 4.8 = 20.8 con φ16), redondeada hacia
  // ARRIBA por ser un mínimo normativo → 21. El trazo le resta el R + φ.
  const gA = FP.ganchoAutoCresta(1.6);
  ok(close(pl.dims.A, Math.ceil(gA), 0.05) && close(pl.dims.F, Math.ceil(gA), 0.05),
    'ganchos A/F = 10φ + R + φ redondeado arriba = ' + Math.ceil(gA) + ' (=' +
    r2(pl.dims.A) + '/' + r2(pl.dims.F) + ')');
  ok(close(pl.dims.B, 52, 0.05) && close(pl.dims.D, 52, 0.05),
    'B/D = alto útil 52 (=' + r2(pl.dims.B) + '/' + r2(pl.dims.D) + ')');
  ok(close(pl.dims.C, 24, 0.05) && close(pl.dims.E, 24, 0.05),
    'C/E = ancho útil 24 (=' + r2(pl.dims.C) + '/' + r2(pl.dims.E) + ')');
}

console.log('Espejo y anidado (la maquinaria del estribo, heredada tal cual):');
{
  const pe = R.expandirComponente(es106({ espejo: true }), viga)[0];
  ok(close(lim(pe, 'y').hi, 25.2) && close(lim(pe, 'z').hi, 11.2),
    'espejada: misma envolvente (los ganchos cambian de esquina, nada se corre)');
  const comp = es106({ distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: 3 } });
  const capas = R.expandirComponente(comp, viga);
  const c1 = capas.filter(p => p.meta.capa === 1)[0], c2 = capas.filter(p => p.meta.capa === 2)[0];
  ok(!!c1 && !!c2, '2 capas generan');
  ok(c2 && close(lim(c2, 'y').hi, lim(c1, 'y').hi - 3) && close(lim(c2, 'z').hi, lim(c1, 'z').hi - 3),
    'capa 2 = anillo CONCÉNTRICO 3 cm adentro');
}

console.log('El 104D no se movió (regresión):');
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
