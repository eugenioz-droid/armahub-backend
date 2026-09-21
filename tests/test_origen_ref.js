// Test headless (Node) del IDENTIFICADOR DE ORIGEN de cada barra (`origen_ref`).
//
// POR QUÉ EXISTE: reabrir una estructura del despiece y volver a generarla tiene que
// ACTUALIZAR las barras, no borrarlas y recrearlas — sólo así conservan su id, su
// historia de edición y la marca de revisión del cubicador. El backend hace ese cruce
// comparando `origen_ref`, que dice de QUÉ componente de la receta y de QUÉ posición de
// su distribución nació cada item. Si el generador deja de emitirlo, o lo emite
// inestable, el sync degenera en "borrar todo y recrear" SIN QUE NADA FALLE a la vista:
// las barras siguen apareciendo, pero cada regeneración les borra la revisión. Este test
// es lo único que lo detectaría.
//
// CONTRATOS QUE FIJA:
//   O1 · Sin trazarOrigen (biblioteca) NO hay origen_ref y la agrupación es la de siempre.
//   O2 · Con trazarOrigen cada item trae 'uid#ordinal' y no se repiten.
//   O3 · El uid manda sobre la posición: reordenar los componentes NO cambia el ref de
//        cada barra (es lo que permite que la barra siga siendo la misma).
//   O4 · Cambiar una MEDIDA no mueve el ref (el item se actualiza, no se reemplaza).
//   O5 · Dos componentes que producen barras IDÉNTICAS quedan en items separados: si se
//        fusionaran, el item no tendría un origen único y el cruce sería ambiguo.
//   O6 · Regenerar dos veces lo mismo da los mismos refs (determinista).
//
// Correr con: node tests/test_origen_ref.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

const CTX = { sector: 'VCIELO', piso: 'P4', ciclo: 'C1', eje: 'E3', trazarOrigen: true };

// Cabezal recto (101A) pegado a una cara: un componente = una tanda de barras iguales.
function cabezal(uid, tipologia, cara, n) {
  return {
    uid: uid, comp_id: uid, tipologia: tipologia, figura: '101A', diam: 1.6, cara: cara,
    distribucion: { modo: 'layered', n_capas: 1, n_por_capa: (n || 2), sep: 10 }
  };
}
function receta(comps) {
  return {
    tipo: 'viga',
    geometria: { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
    componentes: comps
  };
}
const refs = (out) => out.barras.map(b => b.origen_ref);

// ---------------------------------------------------------------- O1
console.log('O1 — sin traza el generador queda EXACTAMENTE como estaba');
{
  const r = receta([cabezal('A', 'CBS', 'sup'), cabezal('B', 'CBI', 'inf')]);
  const out = G.generarViga(r, { sector: 'VCIELO', piso: 'P4', ciclo: 'C1', eje: 'E3' });
  ok(out.barras.length > 0, 'genera barras');
  ok(out.barras.every(b => b.origen_ref === undefined), 'ninguna trae origen_ref');
  ok(out.barras.every(b => b._uid === undefined), 'ni la clave de trabajo del generador');
}

// ---------------------------------------------------------------- O2
console.log('O2 — con traza cada item dice de dónde salió');
{
  const out = G.generarViga(receta([cabezal('A', 'CBS', 'sup'), cabezal('B', 'CBI', 'inf')]), CTX);
  const rs = refs(out);
  ok(rs.every(r => /^[^#]+#\d+$/.test(r || '')), 'todos con formato uid#ordinal (' + rs.join(', ') + ')');
  ok(new Set(rs).size === rs.length, 'y sin repetidos');
  ok(rs.some(r => r.indexOf('A#') === 0) && rs.some(r => r.indexOf('B#') === 0),
    'el uid es el del componente, no el índice');
  ok(out.barras.every(b => b._uid === undefined), 'la clave de trabajo no sale del generador');
}

// ---------------------------------------------------------------- O3
console.log('O3 — reordenar componentes NO renombra las barras');
{
  const a = cabezal('A', 'CBS', 'sup'), b = cabezal('B', 'CBI', 'inf');
  const antes = G.generarViga(receta([a, b]), CTX);
  const despues = G.generarViga(receta([b, a]), CTX);
  const mapa = (out) => {
    const m = {};
    out.barras.forEach(x => { m[x.origen_ref] = x.dim_a + '|' + x.diam + '|' + x.marca; });
    return m;
  };
  const m1 = mapa(antes), m2 = mapa(despues);
  ok(Object.keys(m1).length === Object.keys(m2).length, 'sale el mismo número de items');
  ok(Object.keys(m1).every(k => m2[k] === m1[k]),
    'y cada ref sigue apuntando a la MISMA barra (el uid manda sobre la posición)');
}

// ---------------------------------------------------------------- O4
console.log('O4 — cambiar una medida actualiza el item, no lo reemplaza');
{
  const antes = G.generarViga(receta([cabezal('A', 'CBS', 'sup')]), CTX);
  const r2 = receta([cabezal('A', 'CBS', 'sup')]);
  r2.geometria.largo = 720;                     // el elemento crece: el cabezal se alarga
  const despues = G.generarViga(r2, CTX);
  ok(refs(antes).join() === refs(despues).join(), 'los refs son los mismos');
  ok(antes.barras[0].dim_a !== despues.barras[0].dim_a, 'aunque la barra mide distinto');
}

// ---------------------------------------------------------------- O5
console.log('O5 — dos componentes iguales SÍ se funden en un item (y la traza sobrevive)');
{
  // ESTE BLOQUE CAMBIÓ DE SIGNO EL 21-sep, por corrección del usuario. Antes exigía
  // que con traza los gemelos salieran SEPARADOS, "o el item quedaría sin un origen
  // único". Eso dejaba la doble malla —dos MH idénticas, una por cara— como DOS items
  // en el despiece, que para producción es la misma barra con el doble de cantidad.
  // El origen único no era necesario: el item lleva TODOS sus orígenes ('A#0;B#0') y
  // el sync cruza por cualquiera. La agrupación es ahora la misma con y sin traza.
  const gemelos = [cabezal('A', 'CBS', 'sup'), cabezal('B', 'CBS', 'sup')];
  const sinTraza = G.generarViga(receta(gemelos), { sector: 'X', piso: 'P', ciclo: 'C', eje: 'E' });
  const conTraza = G.generarViga(receta(gemelos), CTX);
  ok(conTraza.barras.length === sinTraza.barras.length,
    'con traza salen los MISMOS items que sin traza (' + conTraza.barras.length + ')');
  const total = (out) => out.barras.reduce((s, b) => s + (b.cant || 0) * (b.mult || 1), 0);
  ok(total(sinTraza) === total(conTraza), 'y el mismo número de barras físicas');
  const fundido = conTraza.barras.find(b => (b.origen_ref || '').indexOf(';') > 0);
  ok(!!fundido, 'el item fundido lleva VARIOS orígenes separados por ; (' + (fundido && fundido.origen_ref) + ')');
  ok(fundido && fundido.origen_ref.indexOf('A#') === 0 && fundido.origen_ref.indexOf(';B#') > 0,
    'uno por cada componente que lo produjo, cada uno con su ordinal');
  // Cada gemelo solo produce N barras; el item fundido tiene que traer 2N.
  const soloA = G.generarViga(receta([cabezal('A', 'CBS', 'sup')]), CTX);
  const cantA = soloA.barras.reduce((s, b) => s + (b.cant || 0), 0);
  ok(fundido && fundido.cant === 2 * cantA,
    'y la cantidad es la SUMA de los dos (' + (fundido && fundido.cant) + ' = 2 × ' + cantA + ')');
  // La tipología SIGUE en la llave: mismo φ y figura pero otra marca NO se funden.
  const distintos = [cabezal('A', 'CBS', 'sup'), cabezal('B', 'CBI', 'sup')];
  const dt = G.generarViga(receta(distintos), CTX);
  ok(dt.barras.every(b => (b.origen_ref || '').indexOf(';') < 0),
    'dos tipologías distintas no se funden aunque midan igual');
}
// ---------------------------------------------------------------- O6
console.log('O6 — determinista');
{
  const r = receta([cabezal('A', 'CBS', 'sup'), cabezal('B', 'CBI', 'inf', 3)]);
  ok(refs(G.generarViga(r, CTX)).join() === refs(G.generarViga(r, CTX)).join(),
    'dos generaciones seguidas dan los mismos refs');
}

console.log(fallos ? ('\n' + fallos + ' FALLO(S)') : '\nTODO OK');
process.exit(fallos ? 1 : 0);
