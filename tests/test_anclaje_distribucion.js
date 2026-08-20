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
// Ahora la receta guarda la INTENCIÓN: cada punto lleva su distancia al BORDE más
// cercano de su eje (borde − o borde +) y el motor resuelve la coordenada contra el
// host EN CADA GENERACIÓN — el mismo trato que las dims en 'auto'.
// SON DOS REFERENCIAS, NO TRES: el 'centro' existió del 18 al 20-ago y lo retiró el
// usuario («cuando eso ocurra parecerá más un error del programa que un ajuste
// pensado»). Un punto anclado a una referencia invisible se quedaba clavado mientras
// el resto de la distribución seguía al hormigón.
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
// E — pos_hint conserva su distancia al borde, y NINGÚN ancla usa `centro`.
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
// 36 y no 40: desde el 19-ago la referencia del ancla de un RANGO es la línea de
// recubrimiento, no la cara del hormigón — el fierro vive en la zona útil, y por eso
// cambiar el recubrimiento tiene que mover el abanico (el usuario: «si modifico el
// recubrimiento no se me ajusta el abanico»). 40 al borde − 4 de recub de extremo = 36.
ok(anclaA && anclaA.ini.ref === 'min' && anclaA.ini.d === 36 &&
   anclaA.fin.ref === 'max' && anclaA.fin.d === 36,
  'el ancla se mide desde el RECUBRIMIENTO: 36 = los 40 dibujados − 4 de recub (=' + JSON.stringify(anclaA) + ')');

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
ok(col.avisos.length > 0 && /36/.test(col.avisos.join(' ')),
  'el tope se AVISA con el número que lo causó (los 36 cm al recubrimiento) (=' +
  (col.avisos[0] || '—').slice(0, 60) + '…)');
const anclaTrasTope = recA.componentes[0].distribucion.rango.ancla;
ok(anclaTrasTope.ini.d === 36 && anclaTrasTope.fin.d === 36,
  'el tope NO reescribió la receta: el anclaje declarado sigue diciendo 36 y 36');
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
// 20-AGO · 140.1 -> 140.2 kg (MEDIDA HASTA LA CRESTA, decision del usuario). Un lado
// ya no se mide a VERTICE: es una medida recta que suma R + phi por cada doblez que lo
// cierra (lado = tramo recto + R + phi). El unico numero de la semilla que se mueve es
// el B del CBS 103B phi16: 590.4 -> 592.0, que es la luz util exacta de la viga
// (600 - 2*4); esos 1.6 cm x 6 barras phi16 pesan 0.1 kg. Las patas 30/30 son FIJAS:
// las escribio el usuario y ni la cresta ni el redondeo las tocan.
ok(JSON.stringify(semCruda.resumen) === '{"items":4,"barras":72,"kg":140.2}',
  'la semilla sigue dando {items:4, barras:72, kg:140.2} (=' + JSON.stringify(semCruda.resumen) + ')');
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

// D4 — UNA RECETA CON ANCLAS VIEJAS ABRE SIN MOVERSE, sea cual sea la forma vieja.
//   · rango con ref 'centro' → `_anclaValida` ya no la reconoce y se re-deriva del
//     propio from/to contra la geometría con la que abre.
//   · pos_ancla del 18-20 ago → anclaba el DESPLAZAMIENTO con las MISMAS refs
//     'min'/'max' de ahora, o sea que a simple vista es INDISTINGUIBLE de una nueva
//     y se leería como una posición. Por eso el ancla de posición DICE QUÉ MIDE
//     (`mide:'pos'`): la que no lo dice no la acepta ningún lector y el motor la
//     re-deriva de pos_hint + la base, que es de donde salía. Sin eso —medido— la
//     101A de una viga 600×60 con pos_hint.y = 20 y su ancla guardada {max, 10}
//     saltaba de y = 45.2 a y = 20 al reabrir el template: 25.2 cm, en silencio.
function conAnclasViejas(viejas) {
  const c = {
    tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', angulos: [135, 135],
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', activa: true, sep: 20, rango: { from: 100, to: 260, sep: 20, eje: 'x' } },
    pos_hint: { y: 3 }
  };
  if (viejas) {
    c.distribucion.rango.ancla = { ini: { ref: 'centro', d: 100 }, fin: { ref: 'max', d: 40 } };
    c.pos_ancla = { y: viejas };            // la que escribía el código viejo
  }
  const r = receta(600, [c]);
  R.normalizarReceta(r);
  return { out: G.generarViga(r, {}), comp: r.componentes[0] };
}
const limpia = conAnclasViejas(null);
[['centro', { ref: 'centro', d: 3 }], ['del desplazamiento', { ref: 'max', d: 27 }]].forEach(function (t) {
  const v = conAnclasViejas(t[1]);
  ok(JSON.stringify(v.out.placements.map(p => p.puntos)) ===
     JSON.stringify(limpia.out.placements.map(p => p.puntos)),
    'receta guardada con ancla ' + t[0] + ' (' + JSON.stringify(t[1]) + '): abre EXACTAMENTE ' +
    'igual que una sin ancla, punto por punto (' + v.out.resumen.barras + ' barras, ' +
    v.out.resumen.kg + ' kg)');
});
ok(limpia.comp.distribucion.rango.ancla.ini.ref === 'max' &&
   limpia.comp.distribucion.rango.ancla.ini.d === 196 &&
   limpia.comp.pos_ancla.y.ref === 'max',
  '…y las anclas quedan re-derivadas a bordes (=' +
  JSON.stringify(limpia.comp.distribucion.rango.ancla.ini) + ' · ' +
  JSON.stringify(limpia.comp.pos_ancla) + ')');

// El caso que lo delataba, con el número: la 101A de la viga 600×60.
const guardadaVieja = {
  comp_id: 'L1', jerarquia: 1, tipologia: 'LO', figura: '101A', diam: 16, cara: 'inferior',
  modo: 'puntual', plano_pieza: { orientacion: 'acostada', volteado: false },
  dims: { A: { modo: 'auto' } }, pos_hint: { y: 20 },
  pos_ancla: { y: { ref: 'max', d: 10 } },      // ancla del DELTA (código 18-20 ago)
  distribucion: { modo: 'layered', activa: false }
};
const recVieja = receta(600, [guardadaVieja]);
R.normalizarReceta(recVieja);
const yVieja = r4(G.generarViga(recVieja, {}).placements[0].puntos[0].y);
ok(yVieja === 45.2,
  'la 101A guardada el 19-ago reabre en y = 45.2, donde el usuario la dejó — no en ' +
  'y = 20, que es lo que decía su ancla del delta leída como posición (=' + yVieja + ')');
// …Y SIN PASAR POR EL NORMALIZADOR. No todos los consumidores abren por esa puerta:
// el "Abrir template" del Enfierrador (panel_3d) arma la receta con los `params`
// crudos del backend y llama derecho a generarViga. Por eso la marca vive en el
// ANCLA y no en el normalizador: la migración no puede depender de por dónde entró.
const yCrudo = r4(G.generarViga(receta(600, [clon(guardadaVieja)]), {}).placements[0].puntos[0].y);
ok(yCrudo === 45.2,
  'y generando en crudo (sin normalizarReceta) da lo mismo: 45.2 (=' + yCrudo + ')');
const nuevaMarcada = receta(600, [clon(guardadaVieja)]);
delete nuevaMarcada.componentes[0].pos_ancla;
G.generarViga(nuevaMarcada, {});
ok(nuevaMarcada.componentes[0].pos_ancla.y.mide === 'pos',
  'el ancla que estampa el motor DICE QUÉ MIDE (=' +
  JSON.stringify(nuevaMarcada.componentes[0].pos_ancla) + ')');
// …y una marcada SÍ se respeta: sube el alto y la barra la sigue (no se re-deriva).
nuevaMarcada.geometria.alto = 80;
R.reanclarReceta(nuevaMarcada);
ok(r4(G.generarViga(nuevaMarcada, {}).placements[0].puntos[0].y) === 55.2,
  '…y una marcada sobrevive: a 80 de alto la barra sigue a sus 15.2 de la cara (55.2)');

// D5 — ABRIR SIN TOCAR NADA NO ENSUCIA EL TEMPLATE. El editor sella el estado
// "recién abierto" DESPUÉS de la 1ª regeneración, y vuelve a normalizar cuando llega
// el catálogo real (asíncrono) SIN regenerar. Si el normalizador tocara el pos_ancla,
// ese 2º sello quedaría sin él y la regeneración siguiente lo re-estamparía → el
// botón de guardar se encendería solo, sin que el usuario hiciera nada.
const recSello = S.semillaViga();
recSello.componentes.push(clon(guardadaVieja));
R.normalizarReceta(recSello); G.generarViga(recSello, {});
const sello = JSON.stringify(recSello);
R.normalizarReceta(recSello);                       // llegada del catálogo: re-normaliza
ok(JSON.stringify(recSello) === sello,
  're-normalizar una receta ya abierta NO la cambia (sin eso, el 2º sello del ' +
  'dirty-tracking dejaba el template "sucio" solo)');
G.generarViga(recSello, {});
ok(JSON.stringify(recSello) === sello, '…y la regeneración siguiente tampoco la mueve');

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
// EL ANCLA DEL pos_hint LA ESTAMPA EL MOTOR, no el normalizador (21-ago): desde que
// se ancla la POSICIÓN y no el desplazamiento hace falta saber dónde NACE la pieza
// sin traslación, y eso sólo existe mientras se expande. El editor expande al abrir
// (_normalizarRecetaViva → _renderPanel → _regenerar), así que el ancla queda amarrada
// a la geometría CON LA QUE ABRE igual que antes; acá se hace ese mismo primer pase.
R.expandirComponente(puntual, host(600));
ok(puntual.pos_ancla && puntual.pos_ancla.x.ref === 'max' && puntual.pos_ancla.x.d === 50,
  'el hint se ancla a 50 cm del testero (=' + JSON.stringify(puntual.pos_ancla) + ')');
[[600, 250], [800, 350], [400, 150]].forEach(function (t) {
  recE.geometria.largo = t[0];
  R.reanclarReceta(recE);
  const x = r4(R.expandirComponente(puntual, host(t[0]))[0].puntos[0].x);
  ok(x === t[1], 'largo ' + t[0] + ' → x = ' + t[1] + ' (sigue a 50 cm del testero) (=' + x + ')');
});
// UNA BARRA AL MEDIO SE ANCLA A UN BORDE, NO AL CENTRO (21-ago, decisión del
// usuario: «no quiero que se ancle en el centro. Definitivamente no queremos eso»).
// Hasta el 20-ago había una 3ª referencia y esta misma barra se quedaba clavada en
// x = 0 al crecer la viga. Ahora declara sus 300 cm al testero de origen y los
// conserva: a 800 aparece en −100. Es el mismo criterio que ve el usuario en
// pantalla (una distancia a una cara), no una referencia invisible.
const alMedio = clon(puntual); alMedio.pos_hint = { x: 0 }; delete alMedio.pos_ancla;
const recE0 = receta(600, [alMedio]);
R.normalizarReceta(recE0);
R.expandirComponente(alMedio, host(600));            // 1ª generación: estampa el ancla
ok(alMedio.pos_ancla.x.ref === 'min' && alMedio.pos_ancla.x.d === 300,
  'una barra al medio de una viga de 600 se ancla a 300 cm del testero de origen (=' +
  JSON.stringify(alMedio.pos_ancla) + ')');
recE0.geometria.largo = 800; R.reanclarReceta(recE0);
ok(r4(R.expandirComponente(alMedio, host(800))[0].puntos[0].x) === -100,
  '…y a 800 sigue a esos 300 cm del testero: x = −100, ya NO se queda al medio (=' +
  r4(R.expandirComponente(alMedio, host(800))[0].puntos[0].x) + ')');
ok(JSON.stringify(recA.componentes[0].distribucion.rango.ancla).indexOf('centro') < 0 &&
   JSON.stringify(alMedio.pos_ancla).indexOf('centro') < 0,
  'NINGÚN ancla —ni de rango ni de posición— sale con la referencia `centro`');

// =============================================================================
console.log('\nE2 — SE ANCLA LA POSICIÓN, NO EL DESPLAZAMIENTO:');
// `pos_hint` no es dónde está la barra: es una TRASLACIÓN que se suma a su geometría
// base. Para un estribo da igual (nace en 0, su hint ES su posición), pero para todo
// lo demás anclar la traslación guardaba un número que no describe ningún fierro.
// CASO MEDIDO — 101A sobre una viga 600×60: nace en y = 25.2 y con pos_hint.y = 20
// queda en y = 45.2, o sea 15.2 cm por ENCIMA de la cara superior (que está en 30).
// Anclando el DELTA, su ancla decía {max, 10} («a 10 cm de la cara superior») y al
// llevar la viga a 80 de alto resolvía la traslación a 30 → la barra se iba a
// y = 65.2: 25.2 fuera. El anclaje EMPUJABA la barra hacia afuera.
function longi(hint) {
  return {
    comp_id: 'L1', jerarquia: 1, tipologia: 'LO', figura: '101A', diam: 16, cara: 'inferior',
    modo: 'puntual', plano_pieza: { orientacion: 'acostada', volteado: false },
    dims: { A: { modo: 'auto' } }, pos_hint: clon(hint),
    distribucion: { modo: 'layered', activa: false }
  };
}
function hostAlto(a) { return Object.assign(host(600), { alto: a }); }
function yDe(c, h) { return r4(R.expandirComponente(c, h)[0].puntos[0].y); }

const arriba = longi({ y: 20 });
ok(yDe(arriba, hostAlto(60)) === 45.2, 'la 101A con pos_hint.y = 20 queda en y = 45.2 (=' +
  yDe(arriba, hostAlto(60)) + ')');
ok(arriba.pos_ancla.y.ref === 'max' && r4(arriba.pos_ancla.y.d) === -15.2,
  'y su ancla dice {max, −15.2}: DÓNDE ESTÁ el fierro (15.2 pasada la cara superior), ' +
  'no los {max, 10} del desplazamiento (=' + JSON.stringify(arriba.pos_ancla) + ')');
ok(yDe(arriba, hostAlto(80)) === 55.2,
  'viga de 80 de alto: la barra sigue 15.2 cm sobre la cara superior → y = 55.2, ' +
  'no 65.2 como daba el ancla del desplazamiento (=' + yDe(arriba, hostAlto(80)) + ')');

// El caso normal (barra DENTRO del hormigón) es el que más se nota: arrastrada al
// fondo del vano, a 10.2 cm de la cara inferior, se queda a 10.2 pase lo que pase.
const abajo = longi({ y: -45 });
ok(yDe(abajo, hostAlto(60)) === -19.8, 'arrastrada al fondo: y = −19.8 (=' + yDe(abajo, hostAlto(60)) + ')');
ok(abajo.pos_ancla.y.ref === 'min' && r4(abajo.pos_ancla.y.d) === 10.2,
  '…su ancla son los 10.2 cm a la cara inferior (=' + JSON.stringify(abajo.pos_ancla) + ')');
ok(yDe(abajo, hostAlto(80)) === -29.8 && r4(abajo.pos_hint.y) === -65,
  'alto 80 → y = −29.8, los mismos 10.2 de la cara inferior; el hint se RE-DERIVA a −65 ' +
  '(era −45): es un valor calculado, como from/to (=' + yDe(abajo, hostAlto(80)) + ')');
ok(yDe(abajo, hostAlto(40)) === -9.8, 'alto 40 → y = −9.8, otra vez a 10.2 de la cara (=' +
  yDe(abajo, hostAlto(40)) + ')');
ok(yDe(abajo, hostAlto(60)) === -19.8 && r4(abajo.pos_hint.y) === -45,
  'y al volver a 60 vuelve EXACTO a −19.8 con su hint original de −45 (el ancla es el dato)');

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
