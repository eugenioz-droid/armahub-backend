// =============================================================================
// SOFT ERASE DE FIGURAS — «resolver todo, ofrecer sólo lo vivo»
// =============================================================================
// Al retirar una figura del catálogo, ésta no se destruye: pasa a un código
// obsoleto (104B → 104B~1) y las RECETAS que la usaban se repuntan a ese código.
// Eso deja al catálogo del cliente con una asimetría que hay que sostener a
// propósito, y que es el punto EXACTO donde este esquema se cae si alguien la
// deshace sin darse cuenta:
//
//   · el MOTOR pregunta «¿qué significa este código?» → tiene que RESOLVER las
//     obsoletas. Si no, un template repuntado a 104B~1 no se dibuja ni genera
//     barras: el despiece perdería fierro justo por el mecanismo que se puso
//     para no perderlo.
//   · un SELECTOR pregunta «¿qué puedo elegir?» → NO debe ofrecerlas. Se
//     retiraron precisamente para dejar de usarse en barras nuevas.
//
// Este test congela las dos mitades. Si alguien «limpia» el filtro de
// `dibujables()` o hace que `get()` esconda las inactivas, una de las dos se
// rompe y acá se nota.
//
// Correr con: node tests/test_figuras_obsoletas.js
// =============================================================================

'use strict';
const path = require('path');
const CAT = require(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'catalogo_figuras.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// El servidor manda las obsoletas SÓLO cuando se le piden (incluir_obsoletas=true).
// Se simula esa respuesta: la 104B viva redibujada + la retirada 104B~1.
const RESPUESTA = { figuras: [
  { codigo: '104B',   parciales: ['A', 'B', 'C', 'D'], angulos: [45, 45], radio: false,
    activo: true,  obsoleta_de: null },
  { codigo: '104B~1', parciales: ['A', 'B', 'C', 'D'], angulos: [45, 45], radio: false,
    activo: false, obsoleta_de: '104B' },
  { codigo: '101A',   parciales: ['A'], angulos: [], radio: false,
    activo: true,  obsoleta_de: null }
] };

console.log('A — EL MOTOR RESUELVE LAS OBSOLETAS');
const r = CAT.actualizar(RESPUESTA);
ok(r && r.ok, 'el catálogo acepta la respuesta con obsoletas (=' + JSON.stringify(r) + ')');
const obs = CAT.get('104B~1');
ok(!!obs, 'get("104B~1") DEVUELVE la figura: una receta repuntada tiene que poder resolverse');
ok(!!obs && obs.parciales.join('') === 'ABCD',
  '…y con su geometría intacta, que es lo que la receta vieja necesita dibujar (=' +
  (obs ? obs.parciales.join('') : '—') + ')');
ok(CAT.existe('104B~1'), 'existe() también la reconoce');
ok(!!obs && obs.obsoleta_de === '104B', 'y dice de qué código viene (=' + (obs ? obs.obsoleta_de : '—') + ')');

console.log('');
console.log('B — PERO NO SE OFRECE EN LOS SELECTORES');
const ofrecidas = CAT.dibujables();
ok(ofrecidas.indexOf('104B~1') < 0,
  'dibujables() NO la incluye: no se puede elegir para una barra nueva');
ok(ofrecidas.indexOf('104B') >= 0,
  '…pero SÍ ofrece la 104B viva, que es la redibujada (el código quedó libre y se reusó)');
ok(ofrecidas.indexOf('101A') >= 0, 'y el resto del catálogo sigue ofreciéndose normal');

console.log('');
console.log('C — LAS RETIRADAS SE PUEDEN LISTAR («visitarlas»)');
const retiradas = CAT.obsoletas();
ok(retiradas.indexOf('104B~1') >= 0, 'obsoletas() la lista (=' + JSON.stringify(retiradas) + ')');
ok(retiradas.indexOf('104B') < 0, '…y no confunde a la viva con la retirada');

console.log('');
console.log('D — EL ESPEJO ESTÁTICO NO SE ESCONDE SOLO');
// El espejo que viene compilado no trae el campo `activo`. Si se leyera como
// `undefined` → falsy, TODAS sus figuras se considerarían retiradas y el editor se
// quedaría sin ninguna que ofrecer. Por eso el default es TRUE, y esto lo congela.
delete require.cache[require.resolve(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'catalogo_figuras.js'))];
const CAT2 = require(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'catalogo_figuras.js'));
ok(CAT2.dibujables().length > 50,
  'sin llamar a actualizar(), el espejo sigue ofreciendo sus 63 figuras (=' +
  CAT2.dibujables().length + ')');
ok(CAT2.obsoletas().length === 0, 'y ninguna del espejo se toma por retirada');

console.log('');
console.log(fallos ? (fallos + ' FALLO(S)') : 'TODO OK');
process.exit(fallos ? 1 : 0);
