// =============================================================================
// TEST DE MOTOR de la receta del Asistente IA (SPECS §12 · F1.2).
//
// El test mide LO PUBLICADO: toma la receta que produce el constructor Python
// (_construir_receta_muro — tests/test_asistente_backend.py la escribe a JSON)
// y la pasa por el MOTOR REAL (normalizarReceta + generarViga), verificando la
// física del muro: cortinas dentro del hormigón y separadas, trabas cruzando el
// espesor, cabezales en los testeros, estribo de borde acotado a la punta.
//
// Correr con: node tests/test_asistente_receta_motor.js <receta.json>
// =============================================================================
const path = require('path');
const fs = require('fs');

const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
let G = require(path.join(base, 'generar.js'));
if (!G || typeof G.generarViga !== 'function') G = global.ModeladorGenerar;

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const close = (a, b, t) => Math.abs(a - b) < (t || 0.6);

const archivo = process.argv[2];
if (!archivo) { console.error('Uso: node test_asistente_receta_motor.js <receta.json>'); process.exit(2); }
const receta = JSON.parse(fs.readFileSync(archivo, 'utf8'));
const geo = receta.geometria;
const rec = geo.recub_lat;

// El MISMO camino que el editor al abrir: normalizar (deriva anclas, completa
// campos ausentes) y luego generar.
if (R.normalizarReceta) R.normalizarReceta(receta);

const lim = (pl, e) => {
  const v = pl.puntos.map(p => p[e]);
  return { lo: Math.min(...v), hi: Math.max(...v) };
};

// --- expansión por componente: TODOS colocan algo y nada sale del hormigón ---
const porTipo = {};
receta.componentes.forEach((c, i) => {
  const pls = R.expandirComponente(c, geo) || [];
  (porTipo[c.tipologia] = porTipo[c.tipologia] || []).push({ c, pls });
  ok(pls.length > 0, c.tipologia + '#' + i + ' coloca barras (=' + pls.length + ')');
  const margen = 1.5; // holgura chica: ganchos/arcos redondean
  pls.forEach(pl => {
    const x = lim(pl, 'x'), y = lim(pl, 'y'), z = lim(pl, 'z');
    if (!(x.lo >= -geo.largo / 2 - margen && x.hi <= geo.largo / 2 + margen &&
          y.lo >= -geo.alto / 2 - margen && y.hi <= geo.alto / 2 + margen &&
          z.lo >= -geo.ancho / 2 - margen && z.hi <= geo.ancho / 2 + margen)) {
      ok(false, c.tipologia + '#' + i + ' saca fierro del hormigon: x' +
        JSON.stringify(x) + ' y' + JSON.stringify(y) + ' z' + JSON.stringify(z));
    }
  });
});

// --- MV: de pie, corre en la altura, cortinas en ±z dentro del recub ---
(porTipo.MV || []).forEach(({ c, pls }) => {
  const y = lim(pls[0], 'y'), z = lim(pls[0], 'z');
  ok(close(y.hi - y.lo, geo.alto - 2 * rec, 2),
    'MV corre en el alto de borde a borde (=' + (y.hi - y.lo).toFixed(1) + ')');
  ok(Math.abs(z.hi) < geo.ancho / 2 - rec + 0.6 && (z.hi === z.lo || close(z.hi, z.lo, 2)),
    'MV es una cortina plana dentro del recubrimiento (z=' + z.hi.toFixed(1) + ')');
});

// --- las dos cortinas MV quedan en lados OPUESTOS ---
if ((porTipo.MV || []).length === 2) {
  const z0 = lim(porTipo.MV[0].pls[0], 'z').hi, z1 = lim(porTipo.MV[1].pls[0], 'z').hi;
  ok(z0 * z1 < 0, 'las 2 cortinas MV estan en caras opuestas (z ' +
    z0.toFixed(1) + ' / ' + z1.toFixed(1) + ')');
}

// --- MH: acostada, corre en el largo ---
(porTipo.MH || []).forEach(({ c, pls }) => {
  const x = lim(pls[0], 'x');
  ok(close(x.hi - x.lo, geo.largo - 2 * rec, 2),
    'MH corre en el largo de borde a borde (=' + (x.hi - x.lo).toFixed(1) + ')');
});

// --- TC: la traba CRUZA el espesor (no es una barra plana en la cara) ---
(porTipo.TC || []).forEach(({ c, pls }) => {
  const z = lim(pls[0], 'z');
  ok(z.hi - z.lo > geo.ancho - 2 * rec - 2,
    'la traba cruza el espesor (' + (z.hi - z.lo).toFixed(1) + ' de ' + geo.ancho + ')');
  ok(pls.length >= 4, 'la grilla de trabas tiene varias filas y columnas (=' + pls.length + ')');
});

// --- CB: cabezales pegados a los testeros, corriendo en el alto ---
{
  const cbs = porTipo.CB || [];
  cbs.forEach(({ c, pls }) => {
    const x = lim(pls[0], 'x'), y = lim(pls[0], 'y');
    ok(Math.abs(Math.abs(x.hi) - (geo.largo / 2 - rec)) < 6,
      'CB pegado al testero (x=' + x.hi.toFixed(1) + ' de ±' + (geo.largo / 2 - rec) + ')');
    ok(close(y.hi - y.lo, geo.alto - 2 * rec, 2),
      'CB corre en el alto completo (=' + (y.hi - y.lo).toFixed(1) + ')');
  });
  if (cbs.length === 2) {
    const x0 = lim(cbs[0].pls[0], 'x').hi, x1 = lim(cbs[1].pls[0], 'x').hi;
    ok(x0 * x1 < 0, 'hay cabezal en las DOS puntas');
  }
}

// --- EC: estribo de borde ACOTADO a la punta, no el marco completo ---
(porTipo.EC || []).forEach(({ c, pls }) => {
  const x = lim(pls[0], 'x');
  const ancho = x.hi - x.lo;
  ok(ancho < geo.largo / 2,
    'EC acotado (ancho ' + ancho.toFixed(1) + ' << largo ' + geo.largo + ')');
  ok(Math.abs(x.lo) > geo.largo / 4 || Math.abs(x.hi) > geo.largo / 4,
    'EC vive en la punta, no en el centro (x ' + x.lo.toFixed(1) + '..' + x.hi.toFixed(1) + ')');
  const z = lim(pls[0], 'z');
  ok(z.hi - z.lo > geo.ancho - 2 * rec - 2.5,
    'el marco EC abraza el espesor (' + (z.hi - z.lo).toFixed(1) + ')');
});

// --- end-to-end por generar.js: kilos y conteo salen ---
const out = G.generarViga(receta, {});
ok(out && out.resumen && out.resumen.barras > 0,
  'generarViga produce barras (=' + (out && out.resumen && out.resumen.barras) + ')');
ok(out.resumen.kg > 0, 'con kilos (=' + (out.resumen.kg || 0).toFixed(1) + ' kg)');

console.log('');
if (fallos) { console.error('FALLARON ' + fallos + ' checks'); process.exit(1); }
console.log('MOTOR OK — la receta del asistente pasa la fisica del muro');
