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
//   J3 · ANIDADO v3 — anidarFigura es el criterio ÚNICO, y es TOPOLÓGICO:
//        un lado con DOS VECINOS PERPENDICULARES se achica 2δ; un lado EXTREMO
//        (punta libre) queda INTACTO. En una figura CERRADA la cadena da la vuelta
//        → todos los lados tienen 2 vecinos → todos −2δ (+ inset de marco); en un
//        103 el único interior es B; en una cadena más larga son todos los del
//        medio. Nunca se mira el NOMBRE de la figura.
//        SEMÁNTICA CORREGIDA POR EL USUARIO (12-ago), y es lo que fija este test:
//          · «el espaciamiento se lo damos con este campo y debe mandar; al
//             ajustar capas anidadas no debe considerar esta altura: debe ajustar
//             SOLO la medida de B» → el ANIDADO YA NO POSICIONA. La posición de la
//             capa k es k·gap (eje a eje) SIEMPRE, anide o no. En las CERRADAS el
//             campo manda la separación entre marcos (anillos concéntricos: inset
//             = k·gap y dims −2·k·gap); en las ABIERTAS sólo se ajustan dims, con
//             δ = k·φ_propio (holgura contra el fierro de la capa de afuera).
//          · «asumiste que las patas deben alinearse con las de la capa de afuera,
//             y eso no es correcto» (v2, se conserva: patas INTACTAS).
//        El estribo anidado sale con las dims de capa ACHICADAS (el listado/corte
//        no puede mentir).
//        J3e · CAPA QUE NO CABE (hallazgo A del verificador, 12-ago): si el inset
//        k·Sep deja una dim ≤ 0 — o cruza el marco del anillo — esa capa NO se
//        genera y queda anotada en comp._avisos. Antes un Math.max(0, …) la
//        aplastaba a 0 y se dibujaba/mandaba igual (dim_a = 0 = rechazo del
//        backend, bbox fuera del hormigón, todo en silencio).
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

// RESERVA PROPIA de una 103B φ16 con patas de 30 (MIGRACIÓN CABEZAL → TRAZADOR).
// El catálogo le declara dobleces de 45°/45°; el constructor de cabezal los
// ignoraba (patas a 90° = proyección horizontal 0) y por eso el auto-largo daba el
// largo útil pelado. Honrándolos, cada pata AVANZA 30·cos45 = 21.2132 sobre el eje
// de la barra, y además la CRESTA del codo tiene que quedar en línea con el recub
// de extremo → el eje se retira φ/2 = 0.8. Reserva = 22.0132 por punta.
// OJO: esta reserva es de la FIGURA, no de la pila — nada que ver con el φ del
// estribo, que es justo lo que estos asserts protegen.
const RESERVA_103B_30_PHI16 = 30 * Math.SQRT1_2 + 1.6 / 2;   // 22.013203

// ===========================================================================
console.log('CERO REGRESIÓN — la viga-semilla: mismo listado, kg re-derivado:');
// 140.2 → 136.1: el CBS (103B, patas de 30) pasa de B = 592 a
// 592 − 2·22.0132 = 547.974 y sus 6 barras φ16 de 61.745 a 57.575 kg. Con 592 la
// pieza asomaba 21.2 cm FUERA del hormigón por cada extremo (la proyección de la
// pata a 45° que el cabezal no dibujaba). Ítems y barras no se mueven.
const semilla = G.generarViga(S.semillaViga(), {});
ok(semilla.resumen.items === 4 && semilla.resumen.barras === 72 && semilla.resumen.kg === 136.1,
  'semilla = {items:4, barras:72, kg:136.1} (=' + JSON.stringify(semilla.resumen) + ')');

// ===========================================================================
console.log('\nJ0 — normalización 1-BASED de comp.jerarquia:');
ok(R.nivelJerarquia('no') === 'no', "'no' → 'no' (sin jerarquía)");
ok(R.nivelJerarquia(null) === null, 'ausente → null (auto: default por rol)');
ok(R.nivelJerarquia(0) === 1, 'migración 0-based: 0 → nivel 1');
ok(R.nivelJerarquia(2) === 2 && R.nivelJerarquia('3') === 3, 'n ≥ 1 se lee 1-based tal cual');
ok(R.nivelJerarquiaEfectivo(null, 'estribo') === 1, 'default estribo = 1');
// DECISIÓN DEL USUARIO 13-ago: TODO nace en nivel 1 ("el usuario elige si las
// cambia"). Los defaults 2 eran una suposición de viga; las recetas que
// dependían de nacer en 2 (la semilla) lo declaran EXPLÍCITO.
ok(R.nivelJerarquiaEfectivo(null, 'traba') === 1, 'default traba = 1');
ok(R.nivelJerarquiaEfectivo(null, 'cabezal') === 1, 'default cabezal = 1');

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
// (Lo que se protege acá es que NO aparezca el φ del estribo en la cuenta. Lo que
// sí se descuenta es la reserva de la PROPIA figura — ver RESERVA_103B_30_PHI16.)
ok(close(cb2.dim_b, 600 - 2 * 4 - 2 * RESERVA_103B_30_PHI16),
  'cabezal nivel 2: B auto = largo − 2·recubExtremo − su propia reserva de 45° = 547.974, SIN φ1 (el estribo no ocupa extremos) (=' + cb2.dim_b + ')');
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
ok(close(dimsDe(oNo, 'CBS').dim_b, 600 - 2 * 4 - 2 * RESERVA_103B_30_PHI16),
  "con el estribo en 'no', el cabezal nivel 2 da el MISMO 547.974 que con el estribo " +
  "en nivel 1: el 'no' NO aporta φ a la cadena (lo único descontado es la reserva propia de sus 45°)");
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
// (14-ago, Modelo A) la traba es un LONGITUDINAL de_pie: su punta llega a la
// LÍNEA ÚTIL de su nivel (convención del longitudinal, como el CBS a ±296), ya
// no al eje-a-eje −φ/2 de la convención de sección.
ok(close(trabaY('no'), 60 / 2 - 4, 1e-6),
  "traba 'no': su punta llega a la línea útil = 26 (=" + trabaY('no') + ')');
ok(close(trabaY(2), 60 / 2 - 4 - PHI_ES, 1e-6),
  'traba nivel 2: útil por dentro del estribo → 25.2 (=' + trabaY(2) + ')');
ok(close(trabaY(1), trabaY('no'), 1e-6), "nivel 1 y 'no' comparten posición (ambos al recub); difieren en si aportan φ");

// ===========================================================================
console.log('\nJ3 — ANIDADO POR TOPOLOGÍA (anidarFigura v3):');
// CERRADA: la cadena cierra → TODO lado tiene 2 vecinos → todos −2δ. El δ de una
// cerrada es la separación ENTRE MARCOS (opts.sep = k·gap); sin opts.sep cae al
// δ posicional del argumento, que es como la llaman los tests directos.
const anCerr = FP.anidarFigura('104D', { A: 24, B: 52, C: 24, D: 52 }, 0.8, 'estribo');
ok(anCerr.criterio === 'cerrada' && anCerr.inset === 0.8, '104x → criterio cerrada, posiciona por inset de marco');
ok(close(anCerr.dims.A, 22.4) && close(anCerr.dims.B, 50.4) && close(anCerr.dims.C, 22.4) && close(anCerr.dims.D, 50.4),
  'cerrada: TODOS los lados −2δ (2 vecinos perpendiculares cada uno)');
ok(anCerr.vecinos.A === 2 && anCerr.vecinos.D === 2, 'cerrada: la cadena da la vuelta → 2 vecinos en TODO lado');
// CERRADA con separación de marcos propia: el campo Sep manda (anillos concéntricos).
const anCerr2 = FP.anidarFigura('104D', { A: 24, B: 52, C: 24, D: 52 }, 0.8, 'estribo', { sep: 3 });
ok(close(anCerr2.inset, 3) && close(anCerr2.dims.A, 18) && close(anCerr2.dims.B, 46),
  'cerrada con sep 3: inset 3 y lados −2·3 (el campo manda la separación entre marcos) (=' +
  anCerr2.dims.A + '/' + anCerr2.dims.B + ')');

// ABIERTA: sólo se AJUSTAN DIMS (v3: el anidado ya no posiciona nada).
const anAb = FP.anidarFigura('103B', { A: 30, B: 592, C: 30 }, 1.6, 'cabezal');
ok(anAb.criterio === 'abierta', '103x con 2 patas → criterio abierta (corchete)');
ok(close(anAb.dims.B, 592 - 2 * 1.6), 'corchete: B (interior, 2 vecinos) − 2δ = 588.8 (=' + anAb.dims.B + ')');
// SEMÁNTICA v2 QUE SE CONSERVA: «asumiste que las patas deben alinearse con las de
// la capa de afuera, y eso no es correcto» — las patas tienen punta LIBRE.
ok(close(anAb.dims.A, 30) && close(anAb.dims.C, 30),
  'corchete: LAS PATAS (1 vecino, punta libre) NO SE TOCAN (30 / 30) (=' + anAb.dims.A + '/' + anAb.dims.C + ')');
ok(anAb.vecinos.A === 1 && anAb.vecinos.B === 2 && anAb.vecinos.C === 1,
  'y el criterio es la CUENTA DE VECINOS (1/2/1), no la letra ni la figura');
ok(anAb.anchorDelta === undefined,
  'v3: anidarFigura YA NO devuelve anchorDelta — la posición la manda el campo Sep');
// CADENA MÁS LARGA (dims sintéticas A..E): la misma regla, sin un solo caso por
// figura. Los INTERIORES B, C y D se achican 2δ; los EXTREMOS A y E quedan.
// (La v2 usaba la PARIDAD del índice y dejaba C — un interior — sin achicar.)
const anLarga = FP.anidarFigura('103Z', { A: 20, B: 100, C: 40, D: 100, E: 20 }, 1, 'cabezal');
ok(anLarga.criterio === 'abierta' &&
  close(anLarga.dims.A, 20) && close(anLarga.dims.E, 20) &&
  close(anLarga.dims.B, 98) && close(anLarga.dims.C, 38) && close(anLarga.dims.D, 98),
  'cadena A..E: interiores B/C/D −2δ (98/38/98) y extremos A/E intactos (20/20) (=' +
  [anLarga.dims.A, anLarga.dims.B, anLarga.dims.C, anLarga.dims.D, anLarga.dims.E].join('/') + ')');
ok(anLarga.vecinos.A === 1 && anLarga.vecinos.C === 2 && anLarga.vecinos.E === 1,
  'vecinos de la cadena larga: 1/2/2/2/1');
// CADENA DE 2 LADOS (L): los DOS lados son extremos (punta libre) → nada se achica.
// Cambio respecto de la v2, que le restaba δ al tramo. Es la consecuencia directa
// de la regla que pidió el usuario ("extremos intactos") y queda fijada acá.
const anL = FP.anidarFigura('103A', { A: 20, B: 100 }, 1, 'cabezal');
ok(close(anL.dims.A, 20) && close(anL.dims.B, 100),
  'figura en L: los 2 lados son EXTREMO (1 vecino) → intactos (20/100) (=' + anL.dims.B + ')');
const anRec = FP.anidarFigura('101A', { A: 592 }, 1.6, 'cabezal');
ok(anRec.criterio === 'recta' && anRec.dims.A === 592, '101x recta → sin cambio (nada que anidar)');

console.log('\nJ3b — corchete ANIDADO en el distribuidor: SOLO dims, la posición la manda Sep:');
function corcheteCapas(gap) {
  return R.expandirComponente({
    tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: gap, anidar: true }
  }, host);
}
const plCor = corcheteCapas(0);
ok(plCor.length === 2, '2 capas → 2 placements');
ok(close(plCor[1].dims.B, plCor[0].dims.B - 2 * 1.6) && close(plCor[1].dims.A, plCor[0].dims.A),
  'la capa 2 estampa SUS dims: B−2δ (δ=φ=1.6) y las PATAS IGUALES (=' + plCor[1].dims.B + ' / ' + plCor[1].dims.A + ')');
// «Al ajustar capas anidadas no debe considerar esta altura: debe ajustar SOLO la
// medida de B» (usuario, 12-ago). Con Sep 0 las dos capas comparten eje: el
// anidado NO mueve nada por su cuenta. Antes bajaba la capa 2 un φ.
ok(close(plCor[1].puntos[1].y, plCor[0].puntos[1].y, 1e-9),
  'con Sep 0 las dos capas comparten eje: el anidado NO posiciona (=' + plCor[1].puntos[1].y + ')');
const plCor5 = corcheteCapas(5);
ok(close(plCor5[0].puntos[1].y - plCor5[1].puntos[1].y, 5, 1e-9),
  'con Sep 5 la capa 2 baja EXACTAMENTE 5 (el campo manda, anide o no) (=' +
  (plCor5[0].puntos[1].y - plCor5[1].puntos[1].y).toFixed(4) + ')');
ok(close(plCor5[1].dims.B, plCor5[0].dims.B - 2 * 1.6) && close(plCor5[1].dims.A, 30),
  'y el ajuste de dims sigue siendo 2·φ = 3.2, INDEPENDIENTE de Sep (=' + plCor5[1].dims.B + ')');
ok(close(plCor5[1].puntos[0].y, plCor5[0].puntos[0].y - 5, 1e-9),
  'las PUNTAS bajan con la pieza (patas iguales, la barra entera corrida Sep)');

console.log('\nJ3c — estribo ANIDADO: anillos concéntricos separados por el campo Sep:');
function estriboCapas(gap) {
  return R.expandirComponente({
    tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: gap }
  }, host);
}
const plEs = estriboCapas(0.8);
ok(plEs.length === 2, '2 capas → 2 estribos');
ok(close(plEs[0].dims.A, 24) && close(plEs[0].dims.B, 52), 'capa 1 = perímetro al recubrimiento (24 / 52)');
ok(close(plEs[1].dims.A, 24 - 2 * 0.8) && close(plEs[1].dims.B, 52 - 2 * 0.8),
  'capa 2 (Sep 0.8 = fierro contra fierro): cada lado −2·Sep = 22.4 / 50.4 (el listado/corte NO miente)');
function maxEje(pl, e) { return Math.max.apply(null, pl.puntos.map(function (q) { return q[e]; })); }
ok(close(maxEje(plEs[1], 'y'), maxEje(plEs[0], 'y') - 0.8, 1e-6) &&
  close(maxEje(plEs[1], 'z'), maxEje(plEs[0], 'z') - 0.8, 1e-6),
  'y el marco real se encoge Sep por lado (la geometría acompaña a las dims)');
// El campo manda también acá: con Sep 3 el anillo interior entra 3, no un φ.
const plEs3 = estriboCapas(3);
ok(close(plEs3[1].dims.A, 24 - 6) && close(maxEje(plEs3[1], 'y'), maxEje(plEs3[0], 'y') - 3, 1e-6),
  'Sep 3 → anillo interior a 3 cm y lados −6 (18) (=' + plEs3[1].dims.A + ')');

console.log('\nJ3e — CAPA ANIDADA QUE NO CABE: se OMITE con aviso (nunca dims 0):');
// HALLAZGO A (verificador, Tanda 1). El anidado cerrado resta 2·k·Sep a CADA lado.
// Con el Sep default de la UI (sep_capas = 10) un estribo 24×52 llega a:
//     capa 2 (k=1, inset 10) → 24 − 20 = 4   ·  52 − 20 = 32     (cabe, se genera)
//     capa 3 (k=2, inset 20) → 24 − 40 = −16 ·  52 − 40 = 12     (NO cabe)
// Antes un `Math.max(0, …)` aplastaba ese −16 a 0: se dibujaba un estribo de
// ancho CERO, con el bbox fuera del hormigón, y el ítem viajaba al backend con
// dim_a = 0 (que lo RECHAZA) — todo en silencio. Ahora la capa NO se genera y
// queda el aviso en comp._avisos.
// 1) La función: sin clamp y con el veredicto explícito.
const anNoCabe = FP.anidarFigura('104D', { A: 24, B: 52, C: 24, D: 52 }, 0.8, 'estribo', { sep: 20 });
ok(close(anNoCabe.dims.A, -16) && close(anNoCabe.dims.B, 12),
  'sin clamp: la resta se guarda tal cual (A = 24 − 40 = −16, B = 12), no 0/12 (=' +
  anNoCabe.dims.A + '/' + anNoCabe.dims.B + ')');
ok(anNoCabe.cabe === false && /dim A/.test(anNoCabe.motivo || ''),
  'cabe:false + motivo con el lado culpable (=' + anNoCabe.motivo + ')');
const anCabe = FP.anidarFigura('104D', { A: 24, B: 52, C: 24, D: 52 }, 0.8, 'estribo', { sep: 10 });
ok(anCabe.cabe === true && close(anCabe.dims.A, 4) && close(anCabe.dims.B, 32),
  'con Sep 10 la capa 2 SÍ cabe (4 / 32) y se genera igual que siempre (=' +
  anCabe.dims.A + '/' + anCabe.dims.B + ')');
// 2) El distribuidor LAYERED: 3 capas @ Sep 10 → la 3ª se omite (quedan 2).
function estriboNCapas(n, gap) {
  const c = {
    tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: n, barras_capa: 1, gap: gap }
  };
  return { comp: c, pls: R.expandirComponente(c, host) };
}
const e3 = estriboNCapas(3, 10);
ok(e3.pls.length === 2, '3 capas @ Sep 10 → sólo 2 placements: la capa 3 NO se genera (=' + e3.pls.length + ')');
ok(close(e3.pls[1].dims.A, 4) && close(e3.pls[1].dims.B, 32),
  'la capa 2 que SÍ cabe conserva sus dims reales de corte (4 / 32) (=' +
  e3.pls[1].dims.A + '/' + e3.pls[1].dims.B + ')');
ok(!e3.pls.some(p => Number(p.dims.A) <= 0 || Number(p.dims.B) <= 0),
  'NINGÚN placement sale con una dim ≤ 0 (el payload dim_a=0 que el backend rechaza)');
ok((e3.comp._avisos || []).length === 1 && /^Capa 3 anidada no cabe \(Sep 20\): omitida/.test(e3.comp._avisos[0]),
  'comp._avisos registra la capa omitida con su Sep efectivo (=' + JSON.stringify(e3.comp._avisos) + ')');
// El mismo inset 20 llegando por el campo Sep: 2 capas @ Sep 20 → la 2ª se omite.
const e20 = estriboNCapas(2, 20);
ok(e20.pls.length === 1 && (e20.comp._avisos || []).length === 1 &&
  /^Capa 2 anidada no cabe \(Sep 20\)/.test(e20.comp._avisos[0]),
  'Sep 20 → la capa 2 (0/12 con el clamp viejo) se omite y avisa (=' +
  e20.pls.length + ' placement · ' + JSON.stringify(e20.comp._avisos) + ')');
// Y el aviso NO ensucia la receta: _avisos es NO ENUMERABLE (el editor compara la
// receta con JSON.stringify para el dirty-tracking y la guarda entera en params).
ok(JSON.stringify(e20.comp).indexOf('_avisos') === -1,
  '_avisos no se serializa con el componente (no ensucia la receta ni viaja al backend)');
// Sin capas que no quepan, el array queda VACÍO (no se acumulan avisos viejos).
ok((estriboNCapas(2, 3).comp._avisos || []).length === 0,
  'Sep 3 (todo cabe) → sin avisos: se recalculan en cada expansión');
// 3) MARCO del anillo: con dims fijas grandes las dims nunca llegan a 0, pero el
//    marco sí se cruza. Capa 3 (inset 20): w2 = 15 − 3 − 0.4 − 20 = −8.4 → ancho
//    −16.8 (alto 11.2). Se omite igual, avisando con el marco.
const cMarco = {
  tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
  dims: { A: { modo: 'fija', valor: 200 }, B: { modo: 'fija', valor: 200 }, C: { modo: 'fija', valor: 200 }, D: { modo: 'fija', valor: 200 } },
  distribucion: { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 10 }
};
const plMarco = R.expandirComponente(cMarco, host);
// `.some` EN VEZ DE `[0]` (14-ago) — razón física, no acomodo: este componente
// tiene DOS problemas distintos y ahora el motor los dice los dos. El primero es
// que sus dims fijas de 200 cm no mandan el marco (lo fija el hormigón: 11.2 de
// alto), divergencia que antes se dibujaba en silencio; el segundo, el que este
// assert vigila, es la capa 3 que no cabe. El aviso de las dims sale primero
// porque se emite al resolverlas, o sea antes de repartir las capas. Lo que se
// verifica sigue siendo lo mismo: la capa omitida se reporta CON SU MARCO cruzado.
ok(plMarco.length === 2 && (cMarco._avisos || []).some(a => /marco 11\.2×-16\.8/.test(a)),
  'dims > 0 pero MARCO cruzado (11.2×−16.8) → capa omitida con aviso (=' +
  plMarco.length + ' placements · ' + JSON.stringify(cMarco._avisos) + ')');
// 4) Mismo criterio en el distribuidor ARREGLO (una sola regla para los dos).
const cArr = {
  tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
  dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
  modo: 'arreglo',
  distribucion: { modo: 'arreglo', rango: { from: -100, to: 100, sep: 100 }, n_capas: 2, sep_capas: 20, eje_capas: 'z' }
};
const plArr = R.expandirComponente(cArr, host);
ok(plArr.length === 3 && (cArr._avisos || []).length === 1 &&
  /^Capa 2 anidada no cabe \(Sep 20\)/.test(cArr._avisos[0]),
  'arreglo: 3 posiciones × capa 1; la capa 2 (Sep 20) se omite con el mismo aviso (=' +
  plArr.length + ' · ' + JSON.stringify(cArr._avisos) + ')');

console.log('\nJ3d — POSICIÓN = k·Sep SIEMPRE (anide o no); DIMS = asunto aparte:');
// HISTORIA: (1) el apilado usaba δ = k·(φ+gap) — «al poner 1 está sumando esa
// magnitud adicional»; se corrigió a eje a eje. (2) el ANIDADO posicionaba con
// k·φ e IGNORABA el campo — «el espaciamiento para CBI está fijo». v3 separa las
// dos responsabilidades: el campo posiciona SIEMPRE, el anidado sólo ajusta dims.
function capasCorchete(anidar, gap) {
  return R.expandirComponente({
    tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: gap, anidar: anidar }
  }, host);
}
const anGap = capasCorchete(true, 4);
const apGap = capasCorchete(false, 4);
ok(close(anGap[0].puntos[1].y - anGap[1].puntos[1].y, 4, 1e-9) &&
  close(apGap[0].puntos[1].y - apGap[1].puntos[1].y, 4, 1e-9),
  'gap 4: la capa 2 baja 4 CON anidar y SIN anidar — la posición no depende del anidado (=' +
  (anGap[0].puntos[1].y - anGap[1].puntos[1].y).toFixed(4) + ')');
ok(close(anGap[1].dims.B, anGap[0].dims.B - 2 * 1.6) && close(apGap[1].dims.B, apGap[0].dims.B),
  'y lo ÚNICO que cambia el anidado son las dims: B−3.2 anidando, B intacto sin anidar (=' +
  anGap[1].dims.B + ' vs ' + apGap[1].dims.B + ')');
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
