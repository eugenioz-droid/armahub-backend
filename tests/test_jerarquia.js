// Test headless (Node) de la JERARQUÍA 1-BASED + ANIDADO GENERAL POR FIGURA +
// el reparto REAL del rango. Fija cuatro contratos del motor:
//
//   J1 · DIMS AUTO POR NIVEL — una dim 'auto' se mide contra el MARCO ÚTIL DE SU
//        NIVEL, y ese marco sale de las PILAS DE OCUPACIÓN POR CARA: cada dim se
//        mide contra las caras QUE CRUZA (largo → ext/ext, alto → sup/inf,
//        ancho → lat/lat). Un estribo ocupa sup/inf/lat pero NO los extremos
//        (los longitudinales pasan por dentro de él), así que:
//          · traba nivel 2 (cruza sup/inf): 60 − 2·(4 + 0.8) = 50.4 — el estribo
//            SÍ la empuja;
//          · cabezal nivel 2 (cruza ext/ext): 600 − 2·4 = 592 — el estribo NO la
//            empuja. Con el inset escalar anterior daba 590.4, restando un φ8 en
//            unos extremos donde el estribo no está.
//   J2 · jerarquia:'no' — la barra se pega al recubrimiento (inset 0) y NO aporta
//        su φ a la cadena (los niveles siguientes no se corren hacia adentro).
//   J3 · ANIDADO — anidarFigura es el criterio ÚNICO por figura:
//        cerrada (104x) → todos los lados −2δ + inset de marco;
//        abierta/corchete (103x) → SOLO el tramo B −2δ, LAS PATAS INTACTAS, y la
//        polilínea entera δ hacia el núcleo;
//        recta (101x) → sin cambio.
//        δ = k·φ_PROPIO, SIN gap (el gap es del apilado que NO anida).
//        El estribo anidado sale con las dims de capa ACHICADAS (el listado/corte
//        no puede mentir).
//        SEMÁNTICA CORREGIDA POR EL USUARIO probando en pantalla (antes las patas
//        se acortaban δ para alinear las puntas, y δ valía φ+gap):
//          · «asumiste que las patas deben alinearse con las de la capa de afuera,
//             y eso no es correcto»;
//          · con φ+gap «los ajustes fueron mucho más que la medida correcta».
//   J4 · RANGO — el reparto usa el PASO REAL span/(n−1), no el @ nominal: span 24
//        @20 → 3 barras en −12 / 0 / +12 (antes 2, en −12 y +8, con 4 cm muertos).
//
// Correr con: node tests/test_jerarquia.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
const FP = global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-6); }

const host = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const PHI_ES = 0.8;   // φ8 del estribo, en cm

// ===========================================================================
console.log('CERO REGRESIÓN — la viga-semilla no se mueve:');
const semilla = G.generarViga(S.semillaViga(), {});
ok(semilla.resumen.items === 4 && semilla.resumen.barras === 72 && semilla.resumen.kg === 140.3,
  'semilla = {items:4, barras:72, kg:140.3} (=' + JSON.stringify(semilla.resumen) + ')');

// ===========================================================================
console.log('\nJ0 — normalización 1-BASED de comp.jerarquia:');
ok(R.nivelJerarquia('no') === 'no', "'no' → 'no' (sin jerarquía)");
ok(R.nivelJerarquia(null) === null, 'ausente → null (auto: default por rol)');
ok(R.nivelJerarquia(0) === 1, 'migración 0-based: 0 → nivel 1');
ok(R.nivelJerarquia(2) === 2 && R.nivelJerarquia('3') === 3, 'n ≥ 1 se lee 1-based tal cual');
ok(R.nivelJerarquiaEfectivo(null, 'estribo') === 1, 'default estribo = 1');
ok(R.nivelJerarquiaEfectivo(null, 'traba') === 2, 'default traba = 2');
ok(R.nivelJerarquiaEfectivo(null, 'cabezal') === 2, 'default cabezal = 2');

// ===========================================================================
// Receta de 3 componentes con niveles EXPLÍCITOS: ES nivel 1 (φ8), cabezal 103B
// nivel 2 (φ16) y traba nivel 2 (φ8). host.jer_phi queda 1-based: [0, 0.8, 1.6].
function receta(jerES) {
  return {
    tipo: 'viga', geometria: host, componentes: [
      {
        comp_id: 'ES', tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', jerarquia: jerES,
        angulos: [135, 135],
        dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
        distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 100 }], start_offset: 4 }
      },
      {
        comp_id: 'CB2', tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', jerarquia: 2,
        angulos: [45, 45],
        dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
        distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0 }
      },
      {
        comp_id: 'TR2', tipologia: 'TRV', figura: '101A', diam: 8, cara: 'lateral', jerarquia: 2,
        dims: { A: { modo: 'auto' } },
        distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 300 }], start_offset: 4 }
      }
    ]
  };
}
function dimsDe(out, marca) { return out.barras.filter(function (b) { return b.marca === marca; })[0]; }

console.log('\nJ1 — DIMS AUTO POR NIVEL (marco útil del nivel, pila POR CARA):');
const oJ = G.generarViga(receta(1), {});
const cb2 = dimsDe(oJ, 'CBS'), tr2 = dimsDe(oJ, 'TRV'), es1 = dimsDe(oJ, 'ES');
// El cabezal se mide entre los EXTREMOS (x±) y el estribo NO ocupa esa cara:
// cada estribo es un plano YZ que toca UN solo extremo, y el longitudinal pasa
// POR DENTRO del estribo. Su largo lo limita sólo el recubrimiento de extremo.
ok(close(cb2.dim_b, 600 - 2 * 4), 'cabezal nivel 2: B auto = largo − 2·recubExtremo = 592, SIN φ1 (el estribo no ocupa extremos) (=' + cb2.dim_b + ')');
// La traba cruza sup e inf, caras que el estribo SÍ ocupa → ahí sí la empuja.
ok(close(tr2.dim_a, 60 - 2 * (4 + PHI_ES)), 'traba nivel 2: A auto = alto − prof(sup) − prof(inf) = 50.4 (=' + tr2.dim_a + ')');
ok(close(es1.dim_a, 30 - 2 * 3) && close(es1.dim_b, 60 - 2 * 4),
  'estribo nivel 1 (más externo, Σφ previos = 0): sigue al recubrimiento (24 / 52)');
ok(tr2.dim_a < 60 - 2 * 4, 'la barra de nivel 2 que SÍ cruza al estribo se acorta (no lo atraviesa)');
// La misma cuenta, vía la función centralizada (fuente única para dims y anclajes).
const mk = R.marcoUtilNivel({ jerarquia: 2, rol: 'cabezal' }, { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_lat: 3, jer_phi: [0, PHI_ES] });
ok(close(mk.insetJ, PHI_ES) && close(mk.largoUtil, 590.4) && close(mk.altoUtil, 50.4) && close(mk.anchoUtil, 30 - 2 * (3 + PHI_ES)),
  'marcoUtilNivel(nivel 2) → insetJ 0.8 / largoUtil 590.4 / altoUtil 50.4 / anchoUtil 22.4');
ok(R.marcoUtilNivel({ jerarquia: 1 }, { largo: 600, alto: 60, ancho: 30, jer_phi: [0, PHI_ES] }).insetJ === 0,
  'marcoUtilNivel(nivel 1) → insetJ 0 (nivel más externo)');

// ===========================================================================
console.log("\nJ2 — jerarquia:'no' (pegado al recub, NO aporta φ):");
const oNo = G.generarViga(receta('no'), {});
ok(close(dimsDe(oNo, 'CBS').dim_b, 600 - 2 * 4),
  "con el estribo en 'no', el cabezal nivel 2 vuelve a 592: el 'no' NO aporta φ a la cadena");
ok(close(dimsDe(oNo, 'TRV').dim_a, 60 - 2 * 4), "ídem la traba nivel 2 (52)");
// Geometría: una traba 'no' se pega al recubrimiento (eje = recub + φ/2), una de
// nivel 2 detrás de un estribo φ8 se mete 0.8 más adentro.
function trabaY(jer) {
  const rec = receta(1);
  rec.componentes[2].jerarquia = jer;
  const o = G.generarViga(rec, {});
  const pl = o.placements.filter(function (p) { return p.tipologia === 'TRV'; })[0];
  return Math.max.apply(null, pl.puntos.map(function (q) { return q.y; }));
}
ok(close(trabaY('no'), 60 / 2 - 4 - 0.8 / 2, 1e-6),
  "traba 'no': su eje queda a recub + φ/2 = 25.6 (pegada al recubrimiento) (=" + trabaY('no') + ')');
ok(close(trabaY(2), 60 / 2 - 4 - PHI_ES - 0.8 / 2, 1e-6),
  'traba nivel 2: se apoya por dentro del estribo → 24.8 (=' + trabaY(2) + ')');
ok(close(trabaY(1), trabaY('no'), 1e-6), "nivel 1 y 'no' comparten posición (ambos al recub); difieren en si aportan φ");

// ===========================================================================
console.log('\nJ3 — ANIDADO GENERAL POR FIGURA (anidarFigura):');
const anCerr = FP.anidarFigura('104D', { A: 24, B: 52, C: 24, D: 52 }, 0.8, 'estribo');
ok(anCerr.criterio === 'cerrada' && anCerr.inset === 0.8, '104x → criterio cerrada, posiciona por inset de marco');
ok(close(anCerr.dims.A, 22.4) && close(anCerr.dims.B, 50.4) && close(anCerr.dims.C, 22.4) && close(anCerr.dims.D, 50.4),
  'cerrada: TODOS los lados −2δ (2 vecinos perpendiculares cada uno)');
ok(anCerr.dims !== undefined && anCerr.anchorDelta.y === 0, 'cerrada: sin corrimiento extra (el inset ya posiciona)');

const anAb = FP.anidarFigura('103B', { A: 30, B: 592, C: 30 }, 1.6, 'cabezal', { sentido: -1 });
ok(anAb.criterio === 'abierta', '103x con 2 patas → criterio abierta (corchete)');
ok(close(anAb.dims.B, 592 - 2 * 1.6), 'corchete: B − 2δ = 588.8 (=' + anAb.dims.B + ')');
// CAMBIO DE SEMÁNTICA (usuario): antes A y C salían 28.4 (−δ) para que las puntas
// quedaran alineadas con las de la capa exterior. «Asumiste que las patas deben
// alinearse con las de la capa de afuera, y eso no es correcto»: la capa de
// adentro es la MISMA barra doblada igual, sólo corrida δ hacia el núcleo.
ok(close(anAb.dims.A, 30) && close(anAb.dims.C, 30),
  'corchete: LAS PATAS NO SE TOCAN (30 / 30, antes 28.4) (=' + anAb.dims.A + '/' + anAb.dims.C + ')');
ok(close(anAb.anchorDelta.y, -1.6), 'corchete: la polilínea se corre δ hacia el núcleo (anchorDelta.y = s·δ)');
const anL = FP.anidarFigura('103A', { A: 20, B: 100 }, 1, 'cabezal');
ok(close(anL.dims.A, 20) && close(anL.dims.B, 99),
  'figura en L: pata intacta (20) y el tramo −δ por su ÚNICA pata vecina (99)');
const anRec = FP.anidarFigura('101A', { A: 592 }, 1.6, 'cabezal');
ok(anRec.criterio === 'recta' && anRec.dims.A === 592, '101x recta → sin cambio (nada que anidar)');

console.log('\nJ3b — corchete ANIDADO en el distribuidor (la pieza entera entra δ):');
const plCor = R.expandirComponente({
  tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
  dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
  distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: 0, anidar: true }
}, host);
ok(plCor.length === 2, '2 capas → 2 placements');
ok(close(plCor[1].dims.B, plCor[0].dims.B - 2 * 1.6) && close(plCor[1].dims.A, plCor[0].dims.A),
  'la capa 2 estampa SUS dims: B−2δ y las PATAS IGUALES (=' + plCor[1].dims.B + ' / ' + plCor[1].dims.A + ')');
ok(close(plCor[1].puntos[0].y, plCor[0].puntos[0].y - 1.6, 1e-6) &&
  close(plCor[1].puntos[3].y, plCor[0].puntos[3].y - 1.6, 1e-6),
  'las PUNTAS de la capa 2 bajan δ con toda la pieza (NO se alinean con la capa exterior)');
ok(close(plCor[1].puntos[1].y, plCor[0].puntos[1].y - 1.6, 1e-6),
  'el tramo B de la capa 2 va δ (=φ, gap 0) hacia el núcleo: un corchete DENTRO del otro, sin toparse');

console.log('\nJ3c — estribo ANIDADO: dims de capa ACHICADAS:');
const plEs = R.expandirComponente({
  tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
  dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: 0 }
}, host);
ok(plEs.length === 2, '2 capas → 2 estribos');
ok(close(plEs[0].dims.A, 24) && close(plEs[0].dims.B, 52), 'capa 1 = perímetro al recubrimiento (24 / 52)');
ok(close(plEs[1].dims.A, 24 - 2 * 0.8) && close(plEs[1].dims.B, 52 - 2 * 0.8),
  'capa 2 anidada: cada lado −2δ = 22.4 / 50.4 (el listado/corte NO miente)');
function maxEje(pl, e) { return Math.max.apply(null, pl.puntos.map(function (q) { return q[e]; })); }
ok(close(maxEje(plEs[1], 'y'), maxEje(plEs[0], 'y') - 0.8, 1e-6) &&
  close(maxEje(plEs[1], 'z'), maxEje(plEs[0], 'z') - 0.8, 1e-6),
  'y el marco real se encoge δ por lado (la geometría acompaña a las dims)');

console.log('\nJ3d — δ del ANIDADO = k·φ, SIN gap (el gap es del apilado):');
// «los ajustes fueron mucho más que la medida correcta» (usuario): el gap se
// sumaba al δ del anidado, así que la capa 2 se iba φ+gap adentro y se achicaba
// 2·(φ+gap). Anidar es fierro CONTRA fierro: δ = φ y nada más. El gap sigue
// mandando —intacto— en el apilado que NO anida.
//
// ACTUALIZADO 12-ago (decisión del usuario): en el APILADO el gap pasó a ser la
// distancia EJE A EJE, o sea δ = k·gap y NO k·(φ+gap). Antes el usuario escribía
// 1 y las capas se separaban 1+φ: «al poner 1 está sumando esa magnitud
// adicional». El número configurado es ahora el que se acota en el plano. Este
// test fijaba la aritmética vieja (5.6 = φ+gap) y por eso cambia a 4.0 = gap; el
// ANIDADO no se movió (sigue en φ) y las DIMS/kg de nadie cambian: sólo la
// POSICIÓN de las capas ≥2 del apilado.
function capasCorchete(anidar, gap) {
  return R.expandirComponente({
    tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: gap, anidar: anidar }
  }, host);
}
const anGap = capasCorchete(true, 4);
ok(close(anGap[0].puntos[1].y - anGap[1].puntos[1].y, 1.6, 1e-6),
  'ANIDADO con gap 4: la capa 2 igual entra 1.6 = φ (antes 5.6 = φ+gap) (=' +
  (anGap[0].puntos[1].y - anGap[1].puntos[1].y).toFixed(4) + ')');
ok(close(anGap[1].dims.B, anGap[0].dims.B - 2 * 1.6),
  'y se achica 2·φ = 3.2, no 2·(φ+gap) = 11.2 (=' + anGap[1].dims.B + ')');
const apGap = capasCorchete(false, 4);
ok(close(apGap[0].puntos[1].y - apGap[1].puntos[1].y, 4, 1e-6) &&
  close(apGap[1].dims.B, apGap[0].dims.B),
  'SIN anidar el gap es EJE A EJE: capa 2 a exactamente 4 (no 5.6 = φ+gap) y sin achicar dims (=' +
  (apGap[0].puntos[1].y - apGap[1].puntos[1].y).toFixed(4) + ')');
// gap 0 → ejes SUPERPUESTOS, sin clamp: el motor no inventa una separación mínima.
const apCero = capasCorchete(false, 0);
ok(close(apCero[0].puntos[1].y - apCero[1].puntos[1].y, 0, 1e-9),
  'gap 0 → las dos capas comparten eje (dato honesto, sin clamp a φ) (=' +
  (apCero[0].puntos[1].y - apCero[1].puntos[1].y) + ')');

// ===========================================================================
console.log('\nJ4 — RANGO con PASO REAL (conteo == recorrido):');
function rangoZ(from, to, sep) {
  return R.expandirComponente({
    tipologia: 'CBS', figura: '101A', diam: 16, cara: 'sup',
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'linear', rango: { from: from, to: to, sep: sep, eje: 'z' } }
  }, host).map(function (p) { return Math.round(p.puntos[0].z * 1e6) / 1e6; });
}
const z24 = rangoZ(-12, 12, 20);
ok(z24.length === R.redondeoCantidadZona(24, 20), 'coloca EXACTAMENTE las nR=ceil(24/20)+1=3 que promete el conteo (=' + z24.length + ')');
ok(z24.join(',') === '-12,0,12', 'span 24 @20 → z = −12 / 0 / +12, paso real 12 (antes: −12 y +8, 4 cm muertos)');
ok(close(z24[z24.length - 1], 12), 'la última barra cierra el rango (no queda hueco en un extremo)');
const z100 = rangoZ(-100, 100, 20);
ok(z100.length === 11 && close(z100[0], -100) && close(z100[10], 100), 'rango exacto (200 @20) intacto: 11 barras de −100 a 100');
const z25 = rangoZ(0, 25, 10);
ok(z25.length === 4 && close(z25[1] - z25[0], 25 / 3), 'paso real ≤ @ ("cada @ o menos"): 25 @10 → 4 barras cada 8.33');
ok(rangoZ(5, 5, 20).length === 1, 'rango degenerado (span 0) → 1 barra, sin división por cero');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — jerarquía 1-based + anidado por figura + rango con paso real.');
