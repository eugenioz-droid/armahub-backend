// =============================================================================
// Test headless (Node) del NORMALIZADOR DE APERTURA — reglas.normalizarComponente.
//
// EL PROBLEMA QUE CUBRE: los templates guardados hace semanas NO tienen los campos
// que el motor fue ganando (pose, tramos del rango, modo de distribución, niveles
// de jerarquía 1-based, dims {modo,valor}). Se abrían igual, pero cada consumidor
// los derivaba por su cuenta y no siempre igual — y algunos ni se derivaban:
//   · una dim escrita como NÚMERO PLANO (el shape del enfierrador) no matcheaba
//     `d.modo === 'fija'` y se resolvía como 'auto': el valor que el usuario había
//     fijado se perdía en SILENCIO;
//   · una distribución sin `modo` caía en el `default` del switch → CERO barras,
//     sin decir por qué;
//   · un parcial de la figura sin declarar ni se recorría → dim_x = null en el
//     payload (que el backend rechaza) y el lado dibujado en NaN;
//   · una `pose:{}` guardada a medias se rellenaba con el default sup/x y ENTERRABA
//     la `cara` vieja: {cara:'inf', pose:{}} abría en la cara SUPERIOR.
//
// LO QUE SE VERIFICA ACÁ:
//   N0 · IDEMPOTENCIA — normalizar dos veces da EXACTAMENTE lo mismo (receta,
//        vista canónica y placements).
//   N1 · POSE — receta sin pose (sólo cara/orientación) ≡ la pose explícita
//        equivalente, byte a byte; y una pose inservible no entierra los campos
//        viejos.
//   N2 · JERARQUÍA — ausente → default del rol (1 desde el 13-ago); 0-based viejo
//        → 1; 'no' se conserva; el nivel declarado NO se toca.
//   N3 · DISTRIBUCIÓN — sin tramos = @ único (no se inventan tramos); sin rango se
//        sigue repartiendo por zonas; el `modo` ausente se deriva de la FORMA;
//        `rango.eje` NO se estampa; sin distribución = 0 barras CON aviso.
//   N4 · DIMS — número plano (enfierrador) ≡ {modo:'fija',valor}, y la receta del
//        enfierrador NO se reescribe; parcial ausente → auto; 'fija' sin valor no
//        se inventa, se avisa.
//   N5 · FIGURA QUE YA NO EXISTE — no explota: queda MARCADA (_migracion +
//        comp._avisos, no enumerables) y no se genera barra.
//   N6 · VIGA-SEMILLA — la referencia viva sigue en {items:4, barras:72, kg:136.1}
//        antes y después de normalizar (dos veces).
//
// Correr con: node tests/test_normalizador.js
// =============================================================================

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const SEM = require(path.join(base, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function J(v) { return JSON.stringify(v); }
function clon(o) { return JSON.parse(JSON.stringify(o)); }

const viga = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const muro = { largo: 400, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };

// Componente VIEJO de referencia: como se guardaban antes de la pose (cara suelta,
// sin jerarquía, sin modo, dims {modo,valor}).
function viejo(extra) {
  return Object.assign({
    tipologia: 'CBS', figura: '103B', diam: 16, suf_tipo: '', cara: 'sup',
    angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 4, sentido: 'nucleo' }
  }, extra || {});
}
function exp(c, h) { return R.expandirComponente(c, h || viga); }

// ===========================================================================
console.log('\nN0 — IDEMPOTENCIA: normalizar dos veces da lo MISMO');
// ===========================================================================
// Es la propiedad que hace confiable a un normalizador: la vista canónica no se
// lee de sí misma, se recalcula siempre desde la declaración enumerable. Si no lo
// fuera, cada regeneración del editor (que llama al motor en cada tecla) movería
// un poco más la receta.
(function () {
  const c = viejo();
  R.normalizarComponente(c);
  const receta1 = J(c), mig1 = J(c._migracion), dims1 = J(c._dims), pose1 = J(c._pose);
  const pls1 = J(exp(clon(c)));
  R.normalizarComponente(c);
  R.normalizarComponente(c);
  ok(J(c) === receta1, 'la RECETA no se mueve en la 2ª ni la 3ª pasada');
  ok(J(c._migracion) === mig1, '…ni la migración (=' + c._migracion.derivados.length + ' derivados)');
  ok(J(c._dims) === dims1 && J(c._pose) === pose1, '…ni las dims canónicas ni la pose');
  ok(J(exp(c)) === pls1, '…ni los PLACEMENTES que salen de ella');
  // Los campos derivados no viajan al backend ni ensucian el dirty-tracking del
  // editor (que compara la receta con JSON.stringify).
  const enumerables = Object.keys(c);
  ok(['_pose', '_dims', '_dist', '_jerarquia', '_migracion', '_avisos', '_rol']
    .every(k => enumerables.indexOf(k) < 0),
    'ninguna vista canónica es enumerable (no viaja en params ni ensucia el guardado)');
  ok(J(clon(c)) === J(clon(c)) && clon(c)._dims === undefined,
    '…comprobado sobre la receta serializada de verdad');
})();

// ===========================================================================
console.log('\nN1 — RECETA SIN POSE (sólo cara + orientación)');
// ===========================================================================
// El contrato de compatibilidad: `cara` es la cara del marco LOCAL y la
// orientación es la permutación de ejes, así que la cara del MUNDO sale de
// componer las dos. La derivación tiene que dar los MISMOS placements que la pose
// explícita equivalente — byte a byte, no "parecidos".
(function () {
  const casos = [
    ['cara sup + acostada  → pose {sup, x}', { cara: 'sup' }, { cara: 'sup', lado: 1, rumbo: 'x' }],
    ['cara inf + acostada  → pose {inf, x}', { cara: 'inf' }, { cara: 'inf', lado: -1, rumbo: 'x' }],
    ['cara lateral + acostada → {lateral, x}', { cara: 'lateral' }, { cara: 'lateral', lado: 1, rumbo: 'x' }],
    ['cara lateral lado −1 → {lateral −1, x}', { cara: 'lateral', lado: -1 }, { cara: 'lateral', lado: -1, rumbo: 'x' }],
    ['cara sup + volteada  → {sup, z}', { cara: 'sup', plano_pieza: { orientacion: 'volteada' } }, { cara: 'sup', lado: 1, rumbo: 'z' }],
    ['cara lateral + volteada → {extremo, z}', { cara: 'lateral', plano_pieza: { orientacion: 'volteada' } }, { cara: 'extremo', lado: 1, rumbo: 'z' }],
    ['cara sup + de_pie    → {extremo, y}', { cara: 'sup', plano_pieza: { orientacion: 'de_pie' } }, { cara: 'extremo', lado: 1, rumbo: 'y' }],
    ['cara lateral + de_pie → {lateral, y}', { cara: 'lateral', plano_pieza: { orientacion: 'de_pie' } }, { cara: 'lateral', lado: 1, rumbo: 'y' }],
    ['volteado:true (botón viejo) ≡ volteada', { cara: 'sup', plano_pieza: { volteado: true } }, { cara: 'sup', lado: 1, rumbo: 'z' }]
  ];
  casos.forEach(function (k) {
    const vieja = viejo(clon(k[1]));
    const nueva = viejo({ pose: clon(k[2]) });
    const pv = R.poseDe(vieja);
    ok(pv.cara === k[2].cara && pv.rumbo === k[2].rumbo && pv.lado === k[2].lado,
      k[0] + ' (=' + J(pv) + ')');
    ok(J(exp(vieja)) === J(exp(nueva)), '   …y genera los MISMOS placements que la pose explícita');
  });
  // Y la pose derivada se publica completa, sin estamparla en la receta.
  const c = viejo({ cara: 'inf' });
  R.normalizarComponente(c);
  ok(c.pose === undefined && c._pose && c._pose.cara === 'inf',
    'la pose derivada se publica en _pose y NO se estampa (el campo viejo sigue mandando)');
  c.cara = 'sup';
  R.normalizarComponente(c);
  ok(c._pose.cara === 'sup', '…cambiar la cara vieja sigue teniendo efecto (se recalcula)');
})();
// Una `pose` guardada a MEDIAS no puede enterrar los campos viejos.
(function () {
  const conVacia = viejo({ cara: 'inf', pose: {} });
  const sinPose = viejo({ cara: 'inf' });
  R.normalizarComponente(conVacia);
  ok(conVacia._pose.cara === 'inf',
    'pose:{} (no dice cara ni rumbo) → se usan los campos viejos: cara inf, no el default sup');
  ok(J(exp(conVacia)) === J(exp(sinPose)),
    '…y los placements son los de la receta vieja equivalente (antes se iban a la cara superior)');
  ok(J(conVacia.pose) === '{}', '…sin rellenar la pose inservible con un default inventado');
  // Un rumbo PARALELO a la cara no existe: se normaliza y se DICE.
  const malRumbo = viejo({ pose: { cara: 'sup', lado: 1, rumbo: 'y' } });
  R.normalizarComponente(malRumbo);
  ok(malRumbo._pose.rumbo === 'x' &&
    (R.migracionDe(malRumbo).avisos || []).some(a => /paralelo a la cara/.test(a)),
    'rumbo y con cara sup (paralelo a la normal) → rumbo x + aviso (=' +
    (R.migracionDe(malRumbo).avisos[0] || '') + ')');
  // …Y EL AVISO TIENE QUE LLEGAR AL USUARIO, QUE NORMALIZA DOS VECES.
  // El editor abre así: normalizarReceta → _regenerar (que vuelve a normalizar
  // dentro de expandirComponente) → recién ahí lee migracionDe para pintar la barra
  // de estado. Como la pose se canoniza IN PLACE, un aviso calculado sólo contra
  // `comp.pose.rumbo` moría en la 2ª pasada: la receta quedaba reescrita (y → x) en
  // SILENCIO. Esto falla si ese aviso vuelve a ser de una sola pasada.
  const ordenReal = viejo({ pose: { cara: 'sup', rumbo: 'y' } });
  R.normalizarComponente(ordenReal);                       // pasada 1 (apertura)
  const plsA = J(exp(ordenReal));                          // pasada 2 (_regenerar)
  ok((R.migracionDe(ordenReal).avisos || []).some(a => /paralelo a la cara/.test(a)),
    'el aviso de rumbo paralelo SIGUE ahí tras normalizar+expandir (el orden real del editor)');
  ok(J(exp(ordenReal)) === plsA && J(R.migracionDe(ordenReal)) === J(R.migracionDe(ordenReal)),
    '…y las pasadas siguientes dan los mismos placements (sigue siendo idempotente)');
  ok(Object.keys(ordenReal.pose).join(',') === 'cara,rumbo,lado,espejo',
    '…la marca que lo recuerda es NO enumerable: la receta guardada no cambia');
  // Si la pose deja de ser la corregida, el aviso se retira (no queda una alarma vieja).
  ordenReal.pose.cara = 'lateral';
  R.normalizarComponente(ordenReal);
  ok((R.migracionDe(ordenReal).avisos || []).length === 0,
    '…y al cambiar la pose el aviso se retira (no es una marca pegada para siempre)');
  // Orientación escrita con un valor que no existe: hoy caía en 'acostada' muda.
  const oriMala = viejo({ plano_pieza: { orientacion: 'diagonal' } });
  R.normalizarComponente(oriMala);
  ok((R.migracionDe(oriMala).avisos || []).some(a => /diagonal/.test(a) && /no existe/.test(a)),
    'plano_pieza.orientacion desconocida → aviso (antes la pieza cambiaba de plano en silencio)');
})();

// ===========================================================================
console.log('\nN2 — JERARQUÍA AUSENTE (el default cambió el 13-ago)');
// ===========================================================================
// Los templates viejos traen 2 estampado o NADA. El default por rol pasó a 1 el
// 13-ago por decisión del usuario ("siempre deben venir en 1, el usuario elige si
// las cambia"), así que una receta que NO declara nivel se abre en 1: no se
// resucita el 2 viejo. Lo que sí se hace es DECIRLO y dejar el número a la vista.
(function () {
  const sin = viejo();
  R.normalizarComponente(sin);
  const j = R.jerarquiaDe(sin);
  ok(j.declarada === null && j.efectiva === 1 && j.rol === 'cabezal',
    'jerarquía ausente → declarada null / efectiva 1 / rol cabezal (=' + J(j) + ')');
  ok((R.migracionDe(sin).derivados || []).some(d => /^jerarquia ←/.test(d)),
    '…anotado en _migracion.derivados, no como aviso (no es un problema, es un default)');
  ok((R.migracionDe(sin).avisos || []).length === 0,
    '…y por eso NO ensucia comp._avisos (que es lo que la UI pinta en rojo)');
  // Nivel DECLARADO: no se toca ni se pisa con el default.
  const dos = viejo({ jerarquia: 2 });
  R.normalizarComponente(dos);
  ok(R.jerarquiaDe(dos).declarada === 2 && R.jerarquiaDe(dos).efectiva === 2,
    'jerarquia:2 estampada (lo que traen los templates viejos) se respeta tal cual');
  // 0-based viejo y 'no'.
  const cero = viejo({ jerarquia: 0 });
  R.normalizarComponente(cero);
  ok(R.jerarquiaDe(cero).declarada === 1,
    'el 0 del esquema 0-based viejo se lee como nivel 1 (pegado al recubrimiento)');
  const no = viejo({ jerarquia: 'no' });
  R.normalizarComponente(no);
  ok(R.jerarquiaDe(no).declarada === 'no' && R.jerarquiaDe(no).efectiva === 'no',
    "'no' (fuera de la cadena) se conserva, no se convierte en un número");
  // Roles: hoy los tres nacen en 1 (por eso una receta vieja sin nivel no se mueve
  // según quién la lea — era una de las inconsistencias de apertura).
  const est = { tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1 } };
  R.normalizarComponente(est);
  ok(R.jerarquiaDe(est).rol === 'estribo' && R.jerarquiaDe(est).efectiva === 1,
    'un estribo sin nivel también nace en 1 (JER_DEFAULT_POR_ROL, todos en 1)');
})();

// ===========================================================================
console.log('\nN3 — DISTRIBUCIÓN sin tramos / sin rango / sin modo');
// ===========================================================================
(function () {
  // A) RANGO SIN TRAMOS = @ ÚNICO. No se inventan tramos: la receta vieja pedía un
  //    solo espaciamiento y eso es lo que tiene que seguir dando.
  const rango = { from: -200, to: 200, sep: 40 };
  const c = viejo({
    tipologia: 'ES', figura: '104D',
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    cara: 'lateral', distribucion: { modo: 'linear', rango: clon(rango) }
  });
  const pls = exp(c);
  ok(pls.length === R.posicionesRango(rango).length && pls.length === 11,
    'rango sin tramos → mismas 11 posiciones que posicionesRango (rama @ único) (=' + pls.length + ')');
  ok(c.distribucion.rango.tramos === undefined,
    '…y el normalizador NO le inventa `tramos` a la receta');
  // B) ZONAS SIN RANGO: la otra forma histórica sigue intacta.
  const zon = viejo({
    tipologia: 'ES', figura: '104D', cara: 'lateral',
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 100 }], start_offset: 4 }
  });
  ok(exp(zon).length === 6, 'zonas sin rango → sigue repartiendo por zonas (6 estribos)');
  // C) MODO DE DISTRIBUCIÓN AUSENTE. Se deriva de la FORMA (lo que la receta ya
  //    decía); antes el switch caía en `default` y salían CERO barras mudas.
  const sinModo = clon(zon); delete sinModo.distribucion.modo;
  const plsSM = exp(sinModo);
  ok(plsSM.length === 6 && R.distribucionDe(sinModo).modo === 'linear',
    'distribución con zonas y sin modo → linear derivado, mismas 6 barras (=' + plsSM.length + ')');
  ok(sinModo.distribucion.modo === undefined,
    '…derivado en la vista canónica, SIN reescribir la receta guardada');
  const capas = viejo({ distribucion: { n_capas: 2, barras_capa: 3, gap: 4 } });
  ok(exp(capas).length === 6 && R.distribucionDe(capas).modo === 'layered',
    'distribución con n_capas/barras_capa y sin modo → layered derivado (6 barras)');
  const nada = viejo({ modo: 'puntual', distribucion: { barras_capa: 2 } });
  ok(R.distribucionDe(nada).modo === 'layered',
    'sin forma reconocible se cae al MODO DE USO del componente (puntual → layered)');
  // D) `rango.eje` NO se estampa: ausente significa "el eje que la pieza recorre",
  //    y eso lo resuelve la permutación de la pose. Estamparlo como eje del MUNDO
  //    congelaría el reparto: al girar la pieza seguiría apuntando al eje de antes.
  const dePie = {
    tipologia: 'EC', figura: '104D', diam: 8, cara: 'lateral',
    plano_pieza: { orientacion: 'de_pie' },
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', rango: { from: -100, to: 100, sep: 100 } }
  };
  const plsDP = exp(dePie, muro);
  R.normalizarComponente(dePie);
  ok(dePie.distribucion.rango.eje === undefined,
    'rango sin eje → NO se le estampa uno (seguiría apuntando al eje viejo al girar)');
  const ejesY = [...new Set(plsDP.map(p => Math.round(p.puntos[0].y * 100) / 100))].sort((a, b) => a - b);
  ok(plsDP.length === 3 && J(ejesY) === J([-100, 0, 100]),
    '…y el estribo DE PIE reparte por su rumbo (Y), no por X: 3 alturas (=' + J(ejesY) + ')');
  // E) SIN DISTRIBUCIÓN: 0 barras, pero DICHO (antes era un cero mudo).
  const mudo = viejo({ distribucion: undefined });
  const plsMudo = exp(mudo);
  ok(plsMudo.length === 0 && (mudo._avisos || []).some(a => /no declara distribución/.test(a)),
    'sin distribución → 0 barras + aviso en comp._avisos (=' + (mudo._avisos || [])[0] + ')');
  const rangoRoto = viejo({ distribucion: { modo: 'linear', sep: 20 } });
  exp(rangoRoto);
  ok((rangoRoto._avisos || []).some(a => /ni zonas ni rango/.test(a)),
    'lineal sin zonas ni rango → aviso explícito (=' + (rangoRoto._avisos || [])[0] + ')');
})();

// ===========================================================================
console.log('\nN4 — DIMS COMO NÚMERO PLANO (shape del ENFIERRADOR)');
// ===========================================================================
// El enfierrador MVP escribe en la MISMA tabla templates_catalogo con dims
// numéricas planas. El motor las ignoraba: `30` no matchea `d.modo === 'fija'` y
// caía en la rama 'auto' — la medida del usuario se perdía sin un aviso.
(function () {
  const plano = viejo({ dims: { A: 30, B: 500, C: 30 } });
  const canon = viejo({
    dims: {
      A: { modo: 'fija', valor: 30 }, B: { modo: 'fija', valor: 500 },
      C: { modo: 'fija', valor: 30 }
    }
  });
  const pP = exp(plano), pC = exp(canon);
  ok(pP[0].dims.A === 30 && pP[0].dims.B === 500 && pP[0].dims.C === 30,
    'dims planas {A:30,B:500,C:30} se respetan (antes A y C salían 9.6, el gancho auto)');
  ok(J(pP) === J(pC), '…y dan los MISMOS placements que el shape {modo:fija,valor}');
  // NO SE REESCRIBE LA RECETA DEL ENFIERRADOR: si el Template Editor abriera y
  // guardara ese template con el shape convertido, el enfierrador dejaría de
  // leerlo. Entenderlo no obliga a reescribirlo.
  ok(typeof plano.dims.A === 'number' && plano.dims.A === 30,
    'la receta del enfierrador NO se convierte a {modo,valor} (sigue siendo el número)');
  ok(R.dimsDeclaradas(plano).A.modo === 'fija' && R.dimsDeclaradas(plano).A.valor === 30,
    '…la conversión vive en la vista canónica (_dims), que es lo que lee el motor');
  const numTexto = viejo({ dims: { A: '30', B: { modo: 'auto' }, C: '30' } });
  ok(exp(numTexto)[0].dims.A === 30, 'un número guardado como texto ("30") también se entiende');
  // PARCIAL AUSENTE → auto (el default documentado de una dim y lo que escribe el
  // editor al elegir la figura). Sin esto ni se recorría: dim_a null en el payload.
  const falta = viejo({ dims: { B: { modo: 'auto' } } });
  const pF = exp(falta);
  ok(pF[0].dims.A != null && pF[0].dims.C != null,
    'parciales A y C sin declarar en un 103B → se resuelven Auto (=' +
    J([pF[0].dims.A, pF[0].dims.C].map(v => Math.round(v * 10) / 10)) + ')');
  ok((R.migracionDe(falta).derivados || []).filter(d => /parcial de 103B/.test(d)).length === 2,
    '…anotado de dónde salió cada uno (2 derivados)');
  ok(falta.dims.A === undefined, '…sin escribirlos en la receta guardada');
  // DIM DECLARADA EN NULL = dim NO declarada (mismo default 'auto'). Antes el null
  // viajaba tal cual y el lado salía AUSENTE del placement: la barra llegaba al
  // despiece sin ese lado.
  const nula = viejo({ dims: { A: { modo: 'fija', valor: 30 }, B: null, C: { modo: 'fija', valor: 30 } } });
  const pN = exp(nula);
  ok(pN[0].dims.B != null, 'dim declarada en null → se resuelve Auto (=' +
    J(Math.round(pN[0].dims.B * 10) / 10) + '), antes el lado B no salía en la barra');
  ok(nula.dims.B === null, '…sin tocarle la receta al usuario (el null sigue en su dato)');
  // LO QUE NO SE PUEDE DERIVAR NO SE INVENTA: 'fija' sin valor es una medida que el
  // usuario pidió y el motor no conoce. Ponerle el 'auto' sería elegir por él.
  const sinValor = viejo({ dims: { A: { modo: 'fija' }, B: { modo: 'auto' }, C: { modo: 'auto' } } });
  exp(sinValor);
  ok(J(R.dimsDeclaradas(sinValor).A) === J({ modo: 'fija' }),
    "dim en 'fija' sin valor → se deja EXACTAMENTE como está (no se convierte a auto)");
  ok((sinValor._avisos || []).some(a => /dim A/.test(a) && /Fija pero no tiene valor/.test(a)),
    '…y se avisa (=' + (sinValor._avisos || [])[0] + ')');
  // Dim huérfana: la receta cambió de figura y quedó la letra que ya no se usa.
  const huerfana = viejo({ figura: '101A', dims: { A: { modo: 'auto' }, D: { modo: 'fija', valor: 12 } } });
  exp(huerfana);
  ok((huerfana._avisos || []).some(a => /dim D/.test(a) && /101A/.test(a)),
    'dim que la figura no usa → aviso, sin borrarle el dato al usuario (=' +
    (huerfana._avisos || [])[0] + ')');
})();

// ===========================================================================
console.log('\nN5 — FIGURA QUE YA NO EXISTE EN EL CATÁLOGO');
// ===========================================================================
// Requisito: que NO explote y que quede MARCADA para que la UI lo diga. El motor
// no puede completar sus dims (no hay parciales) ni su lado dominante, así que no
// se inventa nada: se abre lo que se pueda y se cuenta el porqué.
(function () {
  const muerta = viejo({ figura: '999Z', dims: { A: { modo: 'auto' } } });
  let pls = null, explotó = false;
  try { pls = exp(muerta); } catch (e) { explotó = true; }
  ok(!explotó, 'expandirComponente NO lanza con una figura fuera del catálogo');
  const mig = R.migracionDe(muerta);
  ok(mig && mig.figura_desconocida === true,
    '_migracion.figura_desconocida = true (la marca que la UI puede leer)');
  ok((muerta._avisos || []).some(a => /999Z/.test(a) && /catálogo vigente/.test(a)),
    'y el aviso nombra la figura (=' + (muerta._avisos || [])[0] + ')');
  ok(Object.keys(muerta).indexOf('_migracion') < 0 && Object.keys(muerta).indexOf('_avisos') < 0,
    'las marcas son NO enumerables: no viajan al backend ni ensucian el guardado');
  ok((mig.derivados || []).every(d => !/^dims\./.test(d)),
    'sin spec NO se inventan parciales (no hay de dónde derivarlos)');
  // Y el despiece: la figura desconocida no genera barra (contrato de generar.js).
  const receta = {
    tipo: 'viga', geometria: { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
    componentes: [clon(muerta)]
  };
  const out = G.generarViga(receta, {});
  ok(out.barras.length === 0 && out.resumen.kg === 0,
    'no se genera barra ni kg fantasma para ese componente (=' + J(out.resumen) + ')');
  ok((receta.componentes[0]._avisos || []).length >= 2,
    'y en la barra de estado quedan los DOS avisos: el de apertura y el del despiece (=' +
    (receta.componentes[0]._avisos || []).length + ')');
  // El resto de la receta sigue trabajando: un componente roto no tumba al vecino.
  const mixta = {
    tipo: 'viga', geometria: receta.geometria,
    componentes: [clon(muerta), viejo()]
  };
  const outM = G.generarViga(mixta, {});
  ok(outM.resumen.barras === 6, 'el componente sano de la misma receta genera igual (6 barras)');
})();

// ===========================================================================
console.log('\nN6 — VIGA-SEMILLA: la referencia viva NO se mueve');
// ===========================================================================
(function () {
  const r = SEM.semillaViga();
  const antes = G.generarViga(clon(r), {});
  ok(antes.items !== 0 && J(antes.resumen) === J({ items: 4, barras: 72, kg: 136.1 }),
    'semilla intacta: ' + J(antes.resumen));
  // …y normalizarla (dos veces) tampoco la mueve.
  R.normalizarReceta(r); R.normalizarReceta(r);
  const despues = G.generarViga(r, {});
  ok(J(despues.resumen) === J(antes.resumen),
    'tras normalizar la receta ENTERA dos veces: ' + J(despues.resumen));
  ok(r.componentes.every(c => (R.migracionDe(c).avisos || []).length === 0),
    'y ningún componente de la semilla tiene nada que avisar');
  ok(r.componentes.every(c => c._dims && c._dist && c._jerarquia && c._pose),
    'todos salen con la vista canónica completa (_dims/_dist/_jerarquia/_pose)');
})();

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
