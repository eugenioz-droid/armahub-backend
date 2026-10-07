// TEST DEL FRONT DE AUDITORÍAS — ejecuta el archivo de verdad, no lo lee.
//
// Las reglas de negocio (estado derivado, acciones, resultado) se mudaron al BACKEND
// cuando las auditorías pasaron a la base: ahí se prueban (tests/test_auditorias.py).
// Acá queda lo que de verdad vive en el navegador: que el archivo cargue sin reventar y
// la regla de armado del alcance, donde el clic simple SUMA (a diferencia de los filtros
// de aSa Data, donde el clic deja «sólo ése»).
//
// Correr con: node tests/test_auditorias.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

// El renderer del Bar Manager y el motor del editor, FALSOS: acá se prueba que Auditorías
// les pase lo que esperan (cm, φ en mm, tamaño M), no cómo dibujan.
const llamadasBm = [], llamadasMotor = [];
const sandbox = {
  console, document: { getElementById: () => null },
  fetch: () => Promise.reject(new Error('sin red en el test')), setTimeout, clearTimeout,
  _bmFiguraSvg: (b, tam) => { llamadasBm.push({ b, tam }); return b.figura === '104B' ? '<svg class="bm"></svg>' : ''; },
  _bmTam: () => ({ w: 110, h: 80 }),
  disenadorMotor: { svgDesdePuntos: (pts, o) => { llamadasMotor.push({ pts, o }); return '<svg class="eje"></svg>'; } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const ruta = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'auditorias', 'index.js');
vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: ruta });
const T = sandbox.__auditoriasTest;

console.log('TEST: front de auditorías');
check('el archivo carga y expone sus reglas', !!T && typeof T.marcar === 'function');
if (!T) { console.log('\nFALLOS: 1'); process.exit(1); }

console.log('\n1. Armar el alcance: multi-selección');
check('el clic simple SUMA: se eligen varios pisos sin Ctrl',
      JSON.stringify(T.marcar(T.marcar(['P1'], 'P2'), 'P3')) === '["P1","P2","P3"]');
check('...volver a tocarlo lo quita', JSON.stringify(T.marcar(['P1', 'P2'], 'P1')) === '["P2"]');
check('...y vacío significa todos', JSON.stringify(T.marcar(['P1'], 'P1')) === '[]');

// EL AUDITOR DECLARA UN HECHO, NO UNA NOTA (7-oct). Eran cuatro niveles y dos pedían
// graduar —«NC menor» y «NC mayor»—: dos auditores gradúan distinto el mismo defecto. La
// gravedad la calcula el backend con el estado del código (ver gravedad_de).
console.log('\n2. El vocabulario de la pantalla');
check('tres niveles, y ninguno le pide graduar al auditor',
      Object.keys(T.HALLAZGO_TXT).length === 3 &&
      T.HALLAZGO_TXT.conforme === 'Conforme' && T.HALLAZGO_TXT.observacion === 'Observación' &&
      T.HALLAZGO_TXT.hallazgo === 'Hallazgo' &&
      T.HALLAZGO_TXT.nc_menor === undefined && T.HALLAZGO_TXT.nc_mayor === undefined);
check('los tres estados de la acción: corregir es del cubicador, verificar del auditor',
      T.ACCION_TXT.pendiente === 'Pendiente' && T.ACCION_TXT.corregida === 'Corregida' &&
      T.ACCION_TXT.verificada === 'Verificada');

console.log('\n3. Nada se guarda en el navegador');
const fuente = fs.readFileSync(ruta, 'utf8');
check('no hay localStorage: una auditoría es un registro de calidad, va a la base',
      fuente.indexOf('localStorage') === -1);
check('el estado y las fechas no se calculan acá: vienen del backend',
      fuente.indexOf('function estadoDe') === -1 && fuente.indexOf('function resultadoDe') === -1);

console.log('\n4. La grilla de barras: la del Bar Manager, en cm');
const asa = T.normalizarBarra({ figura: '104B', diam: '10mm', dims: { A: 120, B: 5430 }, angulos: [-135, -90], largo: 5905, radio: 48 }, 'asa');
check('aSa: los lados pasan de mm a cm con su letra, y el φ «10mm» queda en 10',
      asa.figura === '104B' && asa.diam === 10 && asa.dim_a === 12 && asa.dim_b === 543 && asa.dims.A === 12 && !('dim_c' in asa));
check('...el largo también, los ángulos van tal cual y el mandril de aSa NO es el R del Bar Manager',
      asa.largo === 590.5 && asa.angulos.join(',') === '-135,-90' && asa.radio === 0);
const propia = T.normalizarBarra({ figura: '101A', diam: 12, dims: { a: 600 }, angulos: [], radio: 3 }, 'armahub');
check('ArmaHub: las medidas ya están en cm y van tal cual, con su radio', propia.dim_a === 600 && propia.dims.A === 600 && propia.radio === 3);
check('las columnas son las letras que usa alguna barra del elemento, ordenadas',
      T.letrasUsadas([asa, propia, T.normalizarBarra({ dims: { G: 130 } }, 'asa')]).join('') === 'ABG');

console.log('\n5. El dibujo de la barra: el mismo motor que el editor de despieces');
llamadasBm.length = 0;
const celda = T.celdaFigura(T.normalizarBarra({ figura: '104B', diam: '10mm', dims: { A: 1200 } }, 'asa'));
check('con la figura en el catálogo dibuja el Bar Manager, al tamaño M, con las medidas en cm',
      celda === '<svg class="bm"></svg>' && llamadasBm.length === 1 && llamadasBm[0].tam === 'm' && llamadasBm[0].b.dim_a === 120);
llamadasMotor.length = 0;
// Una traba T12 real como la construye el backend: gancho · arco · barra · arco · gancho.
const T12 = { ok: true, puntos: [[0, 0], [-89.1, -94.7], [-67.3, -145.2], [832.7, -145.2], [854.6, -94.7], [765.5, 0]],
  tramos: [{ tipo: 'recto', lado: 'A', largo: 130 }, { tipo: 'arco', lado: '', largo: null, radio: 30, sweep: 1 },
           { tipo: 'recto', lado: 'B', largo: 900 }, { tipo: 'arco', lado: '', largo: null, radio: 30, sweep: 1 },
           { tipo: 'recto', lado: 'G', largo: 130 }] };
const nativa = T.normalizarBarra({ figura: 'T12', diam: '12mm', dims: { A: 130, B: 900, G: 130 }, eje: T12 }, 'asa');
const celdaEje = T.celdaFigura(nativa);
const o = llamadasMotor[0].o;
check('sin la figura en el catálogo, la policurva de aSa se dibuja con el motor: en cm, con grosor por φ',
      celdaEje === '<svg class="eje"></svg>' && llamadasMotor.length === 1 &&
      o.metrico === true && o.diam_mm === 12);
// NINGÚN LADO DESAPARECE. Un gancho de 13 cm junto a una barra de 90 mide medio píxel en
// la miniatura, y una figura sin su gancho no es esa figura. El dibujo deja de ser
// proporcional ahí a propósito: las medidas están en sus columnas, al lado.
var largos = o && llamadasMotor[0].pts.slice(1).map(function (p, i) {
  var a = llamadasMotor[0].pts[i];
  return Math.hypot(p.x - a.x, p.y - a.y);
});
check('...y ningún lado se dibuja por debajo del 18% del mayor',
      largos && Math.min.apply(null, largos) >= Math.max.apply(null, largos) * 0.18 - 0.01);
check('...pero el lado largo NO se achica: sólo se estiran los chicos',
      largos && Math.abs(Math.max.apply(null, largos) - 90) < 0.01);
check('...los ganchos van como ARCOS con su radio (3 cm) y su sentido traducido al del motor (1 → 0), y el motor no les mete codo encima',
      o.tipos_seg.join() === 'recto,arco,recto,arco,recto' && o.radios_seg[1] === 3 && o.sweeps_seg[1] === 0);
check('...cada tramo recto lleva de rótulo la medida del lado en cm; los arcos, nada',
      o.labels.join('|') === '13||90||13' && o.labels_auto === true && o.angulos === true);
check('...y las cotas automáticas de arco del motor van apagadas (ruido en una miniatura)',
      Array.isArray(o.cotas_arco_iso) && o.cotas_arco_iso.length === 0);
const dudosa = T.celdaFigura(T.normalizarBarra({ figura: 'ZZZ', diam: '16mm', dims: { A: 1200 },
  eje: { ok: false, motivo: 'la envolvente no cuadra: construida 2070 × 600, aSa dice 2135 × 297', puntos: [[0, 0], [1200, 0]],
         tramos: [{ tipo: 'recto', lado: 'A', largo: 1200 }] } }, 'asa'));
check('si la envolvente no cuadra se dibuja igual, con el aviso y su porqué al lado',
      dudosa.indexOf('<svg class="eje"></svg>') === 0 && dudosa.indexOf('class="audfigav"') !== -1 && dudosa.indexOf('aSa dice 2135') !== -1);
check('sin figura ni eje, un guion', T.celdaFigura(T.normalizarBarra({ figura: 'ZZZ', diam: '16mm' }, 'asa')).indexOf('—') !== -1);
check('ya no hay un dibujante propio ni la frase de lados: el formato es el de la plataforma',
      fuente.indexOf('function svgBarra') === -1 && fuente.indexOf('Lados / dimensiones') === -1);

// DE DÓNDE SALIÓ LA FIGURA (7-oct). El backend elige: su reconstrucción si cuadra con la
// envolvente que aSa declara, y si no, el trazo que aSa misma exportó en su catálogo (el
// RDX), estirado a las medidas de esta barra. La pantalla no repite esa decisión —sería
// tenerla en dos partes— pero sí la DICE: una figura dibujada con el trazo de aSa se marca,
// porque el auditor tiene derecho a saber qué está mirando.
console.log('\n6. La pantalla dice con qué trazo se dibujó');
const delTrazo = T.normalizarBarra({ figura: 'ZZZ', diam: '12mm', dims: { A: 200 },
  eje: { ok: true, fuente: 'catalogo_asa', puntos: [[0, 0], [2000, 0]],
         tramos: [{ tipo: 'recto', lado: 'A', largo: 2000 }] } }, 'asa');
const celdaFte = T.celdaFigura(delTrazo);
check('la figura que viene del catálogo de aSa queda marcada, y la marca explica por qué',
      celdaFte.indexOf('class="audfigfte"') !== -1 && celdaFte.indexOf('>aSa<') !== -1
      && celdaFte.indexOf('exportó aSa en su catálogo') !== -1);
check('...y NO lleva el ⚠: el trazo de aSa es mejor fuente, no peor',
      celdaFte.indexOf('audfigav') === -1);
const propiaOk = T.celdaFigura(T.normalizarBarra({ figura: 'ZZZ', diam: '12mm', dims: { A: 200 },
  eje: { ok: true, fuente: 'reconstruida', puntos: [[0, 0], [2000, 0]],
         tramos: [{ tipo: 'recto', lado: 'A', largo: 2000 }] } }, 'asa'));
check('la reconstruccion que cuadra no lleva marca ninguna',
      propiaOk === '<svg class="eje"></svg>');
check('la pantalla no vuelve a escalar el trazo: esa decision vive en el backend',
      fuente.indexOf('svgTrazoAsa') === -1 && fuente.indexOf('asa_figuras_catalogo') === -1);

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
