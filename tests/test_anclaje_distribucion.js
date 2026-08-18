// Test headless (Node) del ANCLAJE POR DISTANCIA AL BORDE (18-ago).
//
// QUÉ CONGELA
// -----------------------------------------------------------------------------
// Un template existe para aplicarse a elementos de OTRAS medidas (es lo que hará el
// Enfierrador al instanciarlo). Hasta hoy la receta guardaba la COORDENADA RESUELTA
// (`distribucion.rango.from/to` y `comp.pos_hint` eran cm absolutos del host), así
// que la distribución se quedaba CONGELADA donde se dibujó. Medido con un estribo
// recogido 40 cm de cada borde en una viga de 600:
//     viga 600 → 27 estribos, 40 cm de cada borde   (lo dibujado)
//     viga 800 → 27 estribos, 140 cm de cada borde  (el rango no se movió)
//     viga 400 → 27 estribos, 60 cm de fierro FUERA del hormigón por cada lado
// y una barra puntual arrastrada a 50 cm del testero aparecía a 150 cm del testero
// al pasar la viga a 800.
//
// Ahora la receta guarda la INTENCIÓN: cada punto lleva su distancia a la referencia
// más cercana de su eje (borde −, centro, borde +) y el motor resuelve la coordenada
// contra el host EN CADA GENERACIÓN — el mismo trato que las dims en 'auto'.
//
// A — el mismo componente a 600 / 800 / 400 conserva sus gaps a los bordes y el
//     conteo sube con el mismo @; a 400 no asoma nada fuera del hormigón.
// B — COLISIÓN (las dos distancias se comen el elemento): cada extremo cae en SU
//     borde útil, no se cruzan, y SE AVISA con el número que lo causó. El anclaje
//     declarado NO se toca: al volver a agrandar, reaparece solo.
// C — TRAMO ELÁSTICO: el del MEDIO absorbe el cambio de largo (con nº PAR, los dos
//     del medio se lo reparten); los de los extremos conservan sus centímetros.
// D — ANTI-REGRESIÓN (la prueba que manda): una receta vieja —sin `ancla`— abierta
//     con SU geometría original genera EXACTAMENTE lo mismo que antes, punto por
//     punto y kilo por kilo. La viga-semilla incluida.
// E — pos_hint conserva su distancia al borde.
//
// Correr con: node tests/test_anclaje_distribucion.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const r4 = (v) => Math.round(Number(v) * 1e4) / 1e4;
const clon = (o) => JSON.parse(JSON.stringify(o));

const GEO = { alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
function receta(largo, comps) {
  const g = Object.assign({ largo: largo }, GEO);
  return { tipo: 'viga', geometria: g, componentes: comps };
}
function host(largo) { return Object.assign({ largo: largo }, GEO); }
function estribo(rango) {
  return {
    tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', angulos: [135, 135],
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', rango: rango }
  };
}
// x de cada barra + el mayor asomo fuera del hormigón (cm), medido sobre los puntos.
function repartir(rec) {
  const L = rec.geometria.largo;
  R.reanclarReceta(rec);                      // lo que hace el editor en cada regeneración
  const c = rec.componentes[0];
  delete c._avisos;                           // los avisos son de ESTA pasada
  const pls = R.expandirComponente(c, host(L));
  let fuera = 0;
  pls.forEach(p => p.puntos.forEach(q => { fuera = Math.max(fuera, Math.abs(q.x) - L / 2); }));
  return { xs: pls.map(p => r4(p.puntos[0].x)), fuera: r4(fuera), avisos: c._avisos || [] };
}

// =============================================================================
console.log('A — la distribución SIGUE al hormigón (gaps a los bordes constantes):');
// estribo recogido 40 cm de cada borde en una viga de 600, @20 → 27 barras.
const recA = receta(600, [estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
R.normalizarReceta(recA);
const anclaA = recA.componentes[0].distribucion.rango.ancla;
ok(anclaA && anclaA.ini.ref === 'min' && anclaA.ini.d === 40 &&
   anclaA.fin.ref === 'max' && anclaA.fin.d === 40,
  'el ancla derivada dice lo que el usuario dibujó: 40 cm de cada borde (=' + JSON.stringify(anclaA) + ')');

const a600 = repartir(recA);
ok(a600.xs.length === 27 && a600.xs[0] === -260 && a600.xs[26] === 260,
  '600 → 27 barras de −260 a 260 (lo de siempre) (=' + a600.xs.length + ')');

recA.geometria.largo = 800;
const a800 = repartir(recA);
ok(a800.xs[0] === -360 && a800.xs[a800.xs.length - 1] === 360,
  '800 → los DOS extremos siguen a 40 cm de su borde (−360 / 360) (=' +
  a800.xs[0] + ' / ' + a800.xs[a800.xs.length - 1] + ')');
ok(a800.xs.length === 37,
  '…y con el MISMO @ salen más barras: 27 → 37 (los kilos se mueven, que es lo correcto) (=' +
  a800.xs.length + ')');
ok(a800.xs.every((x, i) => i === 0 || r4(x - a800.xs[i - 1]) <= 20 + 1e-9),
  'el paso real sigue siendo ≤ @ (20 cm)');

recA.geometria.largo = 400;
const a400 = repartir(recA);
ok(a400.xs[0] === -160 && a400.xs[a400.xs.length - 1] === 160,
  '400 → gaps de 40 cm otra vez (−160 / 160), no 60 cm fuera del hormigón (=' +
  a400.xs[0] + ' / ' + a400.xs[a400.xs.length - 1] + ')');
ok(a400.fuera <= 0, 'NINGUNA barra asoma del hormigón a 400 (antes: 60 cm por lado) (=' + a400.fuera + ')');
ok(a400.xs.length === 17, '400 → 17 barras con el mismo @20 (=' + a400.xs.length + ')');

recA.geometria.largo = 600;
const vuelta = repartir(recA);
ok(JSON.stringify(vuelta.xs) === JSON.stringify(a600.xs),
  'volver a 600 devuelve EXACTAMENTE el reparto original (el ancla es el dato, no la coordenada)');

// =============================================================================
console.log('\nB — COLISIÓN: manda el borde del hormigón, y se dice:');
recA.geometria.largo = 60;   // 40 + 40 no caben en 60
const col = repartir(recA);
ok(col.xs[0] === -26 && col.xs[col.xs.length - 1] === 26,
  'cada extremo cae en SU borde útil (±30 ∓ recub 4 = ±26), sin cruzarse (=' +
  col.xs[0] + ' / ' + col.xs[col.xs.length - 1] + ')');
ok(col.fuera <= 0, 'y nada asoma fuera del hormigón (=' + col.fuera + ')');
ok(col.avisos.length > 0 && /40/.test(col.avisos.join(' ')),
  'el tope se AVISA con el número que lo causó (los 40 cm declarados) (=' +
  (col.avisos[0] || '—').slice(0, 60) + '…)');
const anclaTrasTope = recA.componentes[0].distribucion.rango.ancla;
ok(anclaTrasTope.ini.d === 40 && anclaTrasTope.fin.d === 40,
  'el tope NO reescribió la receta: el anclaje declarado sigue diciendo 40 y 40');
recA.geometria.largo = 600;
const trasTope = repartir(recA);
ok(JSON.stringify(trasTope.xs) === JSON.stringify(a600.xs),
  '…y al agrandar de vuelta, los 40 cm reaparecen solos (reparto idéntico al original)');

// =============================================================================
console.log('\nC — TRAMO ELÁSTICO: el del MEDIO absorbe (confinamiento pegado a su extremo):');
function tramosDe(rec) { return rec.componentes[0].distribucion.rango.tramos.map(t => r4(t.long)); }

// @10 / @20 / @10 cubriendo el rango completo (−296…296 = 592 cm).
const recC = receta(600, [estribo({
  from: -296, to: 296, sep: 20, eje: 'x',
  tramos: [{ long: 150, sep: 10 }, { long: 292, sep: 20 }, { long: 150, sep: 10 }]
})]);
R.normalizarReceta(recC);
ok(JSON.stringify(tramosDe(recC)) === JSON.stringify([150, 292, 150]),
  'a su geometría original los tramos no se tocan (=' + JSON.stringify(tramosDe(recC)) + ')');
recC.geometria.largo = 800;
R.reanclarReceta(recC);
ok(JSON.stringify(tramosDe(recC)) === JSON.stringify([150, 492, 150]),
  '600 → 800: el confinamiento conserva sus 150 cm en CADA extremo y el medio se ' +
  'come los 200 (=' + JSON.stringify(tramosDe(recC)) + ')');
// el 3er tramo tiene que quedar PEGADO al extremo lejano, no flotando en medio
const xsC = R.expandirComponente(recC.componentes[0], host(800)).map(p => r4(p.puntos[0].x));
const ultPaso = r4(xsC[xsC.length - 1] - xsC[xsC.length - 2]);
ok(ultPaso <= 10 + 1e-9,
  'y el @10 del extremo lejano llega HASTA el final (último paso ' + ultPaso + ' ≤ 10 cm), ' +
  'en vez de quedar flotando en medio del vano');
recC.geometria.largo = 500;
R.reanclarReceta(recC);
ok(JSON.stringify(tramosDe(recC)) === JSON.stringify([150, 192, 150]),
  '800 → 500: el medio se achica y los extremos siguen intactos (=' + JSON.stringify(tramosDe(recC)) + ')');

// nº PAR de tramos → la diferencia se reparte entre LOS DOS del medio.
const recC4 = receta(600, [estribo({
  from: -296, to: 296, sep: 20, eje: 'x',
  tramos: [{ long: 100, sep: 10 }, { long: 196, sep: 20 }, { long: 196, sep: 20 }, { long: 100, sep: 10 }]
})]);
R.normalizarReceta(recC4);
recC4.geometria.largo = 700;
R.reanclarReceta(recC4);
ok(JSON.stringify(tramosDe(recC4)) === JSON.stringify([100, 246, 246, 100]),
  '4 tramos, +100 cm: 50 y 50 para los DOS del medio (=' + JSON.stringify(tramosDe(recC4)) + ')');

// UN solo tramo → comportamiento de siempre (la cola del @ que continúa hasta `to`).
ok(JSON.stringify(R.posicionesRango({ from: 0, to: 100, tramos: [{ long: 40, sep: 10 }] })
    .map(r4)) === JSON.stringify([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
  'con UN solo tramo no hay medio que estire: sigue la cola del último @ (cero regresión)');

// =============================================================================
console.log('\nD — ANTI-REGRESIÓN: la receta vieja abierta con SU geometría no se mueve:');
// D1 — la viga-semilla (sin `ancla`, con `zonas` en el estribo y un rango legado en
//      la traba): mismos placements, punto por punto, antes y después de anclar.
const semCruda = G.generarViga(S.semillaViga(), {});
const semNorm = (() => { const r = S.semillaViga(); R.normalizarReceta(r); return G.generarViga(r, {}); })();
ok(JSON.stringify(semCruda.resumen) === '{"items":4,"barras":72,"kg":140.1}',
  'la semilla sigue dando {items:4, barras:72, kg:140.1} (=' + JSON.stringify(semCruda.resumen) + ')');
ok(JSON.stringify(semNorm.resumen) === JSON.stringify(semCruda.resumen),
  'y normalizarla (que estampa las anclas) no le mueve NI UN KILO (=' + JSON.stringify(semNorm.resumen) + ')');
ok(JSON.stringify(semNorm.placements.map(p => p.puntos)) ===
   JSON.stringify(semCruda.placements.map(p => p.puntos)),
  '…ni un solo punto de las 72 barras (comparación punto por punto)');
// idempotencia: abrir/normalizar N veces es abrir una vez
const semN3 = (() => { const r = S.semillaViga(); R.normalizarReceta(r); R.normalizarReceta(r); R.normalizarReceta(r); return G.generarViga(r, {}); })();
ok(JSON.stringify(semN3.placements.map(p => p.puntos)) === JSON.stringify(semCruda.placements.map(p => p.puntos)),
  'normalizar 3 veces da lo mismo que 0 (idempotente)');

// D2 — un rango cualquiera: anclar+resolver a su propia geometría es la IDENTIDAD.
[[-260, 260, 20], [-296, 264, 40], [0, 0, 20], [130, -130, 15], [-12, 12, 20]].forEach(function (t) {
  const rec = receta(600, [estribo({ from: t[0], to: t[1], sep: t[2], eje: 'x' })]);
  const antes = R.expandirComponente(clon(rec).componentes[0], host(600)).map(p => r4(p.puntos[0].x));
  R.normalizarReceta(rec); R.reanclarReceta(rec);
  const despues = R.expandirComponente(rec.componentes[0], host(600)).map(p => r4(p.puntos[0].x));
  ok(JSON.stringify(antes) === JSON.stringify(despues),
    'rango ' + t[0] + '…' + t[1] + ' @' + t[2] + ': idéntico antes y después de anclar (' + antes.length + ' barras)');
});

// D3 — el ida y vuelta coordenada → ancla → coordenada es EXACTO.
[[-296, 600], [0, 600], [264, 600], [4, 30], [-15, 30], [-260, 600], [700, 600]].forEach(function (t) {
  const a = R.anclaDeCoord(t[0], t[1]);
  ok(r4(R.coordDeAncla(a, t[1])) === r4(t[0]),
    'ancla(' + t[0] + ' en ' + t[1] + ') = ' + a.ref + '/' + a.d + ' → vuelve a ' + t[0]);
});

// =============================================================================
console.log('\nE — pos_hint: la barra arrastrada conserva su distancia al borde:');
const puntual = {
  tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', angulos: [135, 135],
  dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1 },
  pos_hint: { x: 250 }                       // 50 cm del testero en una viga de 600
};
const recE = receta(600, [puntual]);
R.normalizarReceta(recE);
ok(puntual.pos_ancla && puntual.pos_ancla.x.ref === 'max' && puntual.pos_ancla.x.d === 50,
  'el hint se ancla a 50 cm del testero (=' + JSON.stringify(puntual.pos_ancla) + ')');
[[600, 250], [800, 350], [400, 150]].forEach(function (t) {
  recE.geometria.largo = t[0];
  R.reanclarReceta(recE);
  const x = r4(R.expandirComponente(puntual, host(t[0]))[0].puntos[0].x);
  ok(x === t[1], 'largo ' + t[0] + ' → x = ' + t[1] + ' (sigue a 50 cm del testero) (=' + x + ')');
});
// una barra dejada al MEDIO se queda al medio (el centro es referencia, como en el
// snap del editor): sin esto, x=0 se anclaría a 300 cm de un borde y saltaría 100 cm.
const alMedio = clon(puntual); alMedio.pos_hint = { x: 0 }; delete alMedio.pos_ancla;
const recE0 = receta(600, [alMedio]);
R.normalizarReceta(recE0);
recE0.geometria.largo = 800; R.reanclarReceta(recE0);
ok(r4(R.expandirComponente(alMedio, host(800))[0].puntos[0].x) === 0,
  'una barra dejada al medio del vano SIGUE al medio al cambiar el largo (=' +
  JSON.stringify(alMedio.pos_ancla) + ')');

// =============================================================================
console.log('\nF — PASO DEL ARRASTRE = 1 cm (era 5) sin matar el imán a las caras:');
// El paso vive en template_editor.js (que necesita DOM para cargarse), así que se
// lee del FUENTE — mismo criterio que el chequeo de fuente de test_angulo_barra.
// Es el redondeo del gesto (_snapValor), NO el paso de la grilla que se dibuja
// (_pasoGrilla2D, adaptativo 1‑2‑5): son dos cosas distintas y este test las separa.
const src = require('fs').readFileSync(path.join(base, 'template_editor.js'), 'utf8');
const mPaso = /var PASO_ARRASTRE_CM = (\d+(?:\.\d+)?);/.exec(src);
ok(mPaso && Number(mPaso[1]) === 1, 'PASO_ARRASTRE_CM = 1 cm (=' + (mPaso ? mPaso[1] : 'ausente') + ')');
ok(!/GRID_SNAP\s*=/.test(src), 'ya no queda una 2ª constante (GRID_SNAP) con el paso viejo de 5');
const mSnap = /function _snapValor\(val, faces\) \{([\s\S]*?)\n  \}/.exec(src);
ok(mSnap && /if \(best != null\) return best;[\s\S]*Math\.round\(val \/ PASO_ARRASTRE_CM\) \* PASO_ARRASTRE_CM/.test(mSnap[1]),
  'y la cara se resuelve ANTES que el paso: con paso 1 el redondeo estaría siempre a ' +
  '≤0.5 cm y le ganaría a cualquier cara, matando el snap a nodos en silencio');
ok(/Math\.round\([^)]*\/ 5\) \* 5/.test(src) === false,
  'no queda ningún Math.round(x/5)*5 suelto en el editor');

console.log(fallos ? '\nFALLARON ' + fallos + ' aserciones' :
  '\nOK — anclaje por distancia al borde + tramo elástico + paso 1 cm, sin mover las recetas viejas.');
process.exit(fallos ? 1 : 0);
