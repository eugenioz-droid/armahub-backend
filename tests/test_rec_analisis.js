// PANTALLA DE ANÁLISIS HISTÓRICO — ejecuta el JS de verdad, no lo lee.
//
// POR QUÉ ASÍ. Acá se clasifican 511 reclamos a mano, de a uno, y lo que importa es que
// trabajar seguido no se rompa: que los filtros filtren de verdad, que el contador diga
// lo que falta, y sobre todo que «guardar y siguiente» salte al siguiente PENDIENTE y
// no se quede pegado o vuelva al mismo. Nada de eso se ve mirando el código.
//
// Correr con: node tests/test_rec_analisis.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

const nodos = {};
function nodo(id) {
  if (!nodos[id]) {
    nodos[id] = {
      id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '',
      disabled: false, children: [],
      addEventListener() {}, appendChild() {},
      querySelectorAll() { return []; }, querySelector() { return null; },
    };
  }
  return nodos[id];
}

// El combobox compartido, de mentira: guarda lo que le pasan y deja disparar onSelect.
const combos = [];
function ComboboxFalso(input, opts) {
  const cb = { input, opts, valor: null, setValor(it) { this.valor = it; } };
  combos.push(cb);
  return cb;
}
const sandbox = {
  console, window: {}, ChartDataLabels: {},
  Combobox: { crear: ComboboxFalso },
  abrirIshikawaModal(target) { sandbox.__modalAbierto = target; },
  Chart: function (ctx, cfg) { this.cfg = cfg; this.destroy = function () {}; },
  document: { getElementById: (id) => nodo(id), querySelectorAll: () => [], querySelector: () => null },
  setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => ({}) }),
  apiUrl: (p) => p, authHeaders: () => ({}),
};
sandbox.Chart.defaults = { plugins: {} };
// En el navegador `window` ES el global: `window.Combobox` y `Combobox` son lo mismo. El
// sandbox tiene que imitarlo, o el código que busca `window.Combobox` no lo encuentra.
sandbox.window = sandbox;

// La lista con la forma real del endpoint: dos años, cuatro cubicadores, los tres
// estados. Lo justo para que cada filtro tenga algo que dejar fuera.
const FILAS = [
  { id: 1, correlativo: 'H-2025-001', anio: 2025, fecha: '2025-01-03', obra: 'DESCO', cubicador: 'Gerardo Mendoza', segmento: '4 y 5', tipo: 'faltante', kilos: 180, titulo: 'Faltante eje J', aplica: 'si', categoria: null, cod_causa: null, estado: 'sin_causa' },
  { id: 2, correlativo: 'H-2025-002', anio: 2025, fecha: '2025-01-09', obra: 'SANTOLAYA', cubicador: 'Daniel Venegas', segmento: '4 y 5', tipo: 'error', kilos: null, titulo: 'Patas cortas', aplica: 'si', categoria: 'mano_de_obra', cod_causa: 'MO06', estado: 'por_validar' },
  { id: 3, correlativo: 'H-2024-010', anio: 2024, fecha: '2024-05-02', obra: 'DLP', cubicador: 'José Pantoja', segmento: '1 y 2', tipo: 'error', kilos: 6832, titulo: 'Material duplicado', aplica: 'si', categoria: 'metodo', cod_causa: 'MD01', estado: 'validado' },
  { id: 4, correlativo: 'H-2024-011', anio: 2024, fecha: '2024-06-11', obra: 'DLP', cubicador: 'Gerardo Mendoza', segmento: '1 y 2', tipo: 'atraso', kilos: null, titulo: 'Atraso entrega', aplica: 'no', categoria: null, cod_causa: null, estado: 'sin_causa' },
];
const CAUSAS = [
  { codigo: 'MO06', categoria: 'mano_de_obra', categoria_nombre: 'Mano de Obra', descripcion: 'Error al digitar o transcribir datos' },
  { codigo: 'MD01', categoria: 'metodo', categoria_nombre: 'Método', descripcion: 'No se indica en procedimiento estandarizado' },
];

let abiertos = [];
sandbox.apiGet = async function (ruta) {
  if (ruta === '/reclamos/analisis') return { filas: JSON.parse(JSON.stringify(FILAS)), causas: CAUSAS, anio_tope: 2025 };
  const m = /\/reclamos\/analisis\/(\d+)/.exec(ruta);
  if (m) {
    abiertos.push(Number(m[1]));
    const f = FILAS.filter((x) => x.id === Number(m[1]))[0];
    return Object.assign({}, f, { descripcion: 'detalle', observaciones: null, explicacion: null,
      analista: null, validado_por: null, validado_el: null, acciones: [], fuente: 'planilla x' });
  }
  return null;
};

const codigo = fs.readFileSync(
  path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'reclamos', 'dashboards.js'), 'utf8');
vm.createContext(sandbox);
try { vm.runInContext(codigo, sandbox); } catch (e) { /* carga parcial, basta */ }

console.log('TEST: pantalla de análisis histórico');

console.log('\n1. El sub-tab existe y es sólo de administración');
check('está registrado con su panel', sandbox.REC_SUBTABS && sandbox.REC_SUBTABS.analisis
  && sandbox.REC_SUBTABS.analisis.panel === 'recSubAnalisis');
// Esconder el botón no es un permiso: el backend valida lo mismo. Pero el botón no
// tiene por qué estar ahí tentando a quien no puede entrar.
check('...y limitado al rol admin',
  JSON.stringify(sandbox.REC_SUBTABS.analisis.roles) === JSON.stringify(['admin']));

(async function () {
  await sandbox.cargarAnalisisHistorico();

  console.log('\n1b. Los filtros siguen el diseño de la plataforma');
  // Año, estado y segmento son botones del mismo estilo que los dashboards; el
  // cubicador es el desplegable con búsqueda compartido, montado UNA vez; el tipo, un
  // select. Nada inventado para esta pantalla.
  check('los años se pintan como chips con su cuenta',
    nodo('ahAnios').innerHTML.indexOf('data-v="2025"') >= 0 && nodo('ahAnios').innerHTML.indexOf('<i>2</i>') >= 0);
  check('el estado también', nodo('ahEstados').innerHTML.indexOf('Por validar') >= 0);
  check('el segmento también', nodo('ahSegmentos').innerHTML.indexOf('4 y 5') >= 0);
  check('el cubicador es el combobox compartido, montado una sola vez',
    combos.length === 1 && combos[0].input.id === 'ahCubicador');
  check('...con «Todos» como primera opción y la cuenta de cada uno',
    combos[0].opts.items()[0].id === '' && combos[0].opts.items().some(function (i) { return i.label === 'José Pantoja' && i.sub === '1 reclamos'; }));
  check('el tipo es un select con «Todos» y los tipos en castellano',
    nodo('ahTipo').innerHTML.indexOf('<option value="">Todos</option>') === 0
    && nodo('ahTipo').innerHTML.indexOf('Faltante de cubicación') > 0);

  console.log('\n2. Abre en lo que falta, no en lo ya hecho');
  // Entrar y ver primero los validados sería empezar buscando.
  check('arranca filtrando por sin causa y por validar',
    JSON.stringify(sandbox.AH_F.estado.slice().sort()) === JSON.stringify(['por_validar', 'sin_causa']));
  check('...así que el validado no aparece', sandbox.ahVisibles().length === 3);
  check('y se abrió el primero pendiente solo', nodo('ahLista').innerHTML.indexOf('Faltante eje J') > 0);

  console.log('\n3. Los filtros filtran de verdad');
  sandbox.AH_F.estado.length = 0;
  check('sin filtros se ven los cuatro', sandbox.ahVisibles().length === 4);
  sandbox.AH_F.anio.push(2024);
  check('por año quedan dos', sandbox.ahVisibles().length === 2);
  // Esto es lo que el usuario pidió: sacar del medio a los cubicadores que ya no están.
  sandbox.AH_F.cubicador.push('Gerardo Mendoza');
  check('...y sumando cubicador, uno solo', sandbox.ahVisibles().length === 1);
  check('los filtros se combinan con Y, no con O',
    sandbox.ahVisibles()[0].correlativo === 'H-2024-011');
  sandbox.AH_F.anio.length = 0; sandbox.AH_F.cubicador.length = 0;

  console.log('\n3b. Elegir en el desplegable filtra, y «Todos» suelta');
  combos[0].opts.onSelect({ id: 'Gerardo Mendoza', label: 'Gerardo Mendoza' });
  check('un cubicador elegido deja sólo sus reclamos', sandbox.ahVisibles().length === 2);
  combos[0].opts.onSelect({ id: '', label: 'Todos los cubicadores' });
  check('«Todos» vuelve a mostrar todo', sandbox.AH_F.cubicador.length === 0 && sandbox.ahVisibles().length === 4);

  console.log('\n4. El contador dice lo que falta');
  sandbox.ahPintarLista();
  var av = nodo('ahAvance').innerHTML;
  check('cuenta los que se ven', av.indexOf('<b>4</b> reclamos a la vista') >= 0);
  check('...y cuántos quedan sin validar', av.indexOf('<b>3</b> sin validar') >= 0);

  console.log('\n5. El año en curso NO entra acá');
  // 2026 se lleva en la plataforma con su propio flujo: trabajarlo también acá sería
  // hacer dos veces el mismo reclamo.
  const SRC_PY = fs.readFileSync(path.join(__dirname, '..', 'armahub', 'reclamos.py'), 'utf8');
  check('el backend corta en 2025', SRC_PY.indexOf('ANIO_TOPE_ANALISIS = 2025') > 0);
  check('...y el corte se aplica en la consulta, no sólo se declara',
    SRC_PY.indexOf('r.historico AND r.anio_calidad <= %s') > 0);
  check('...y sólo entra lo histórico: lo vivo tiene su propio flujo',
    SRC_PY.indexOf('WHERE r.id = %s AND r.historico') > 0);

  console.log('\n6. «Guardar y siguiente» salta al siguiente PENDIENTE');
  abiertos = [];
  sandbox.AH_F.estado = ['sin_causa', 'por_validar'];
  sandbox.ahSiguiente(1);                       // desde el primero
  await new Promise((r) => setTimeout(r, 10));
  check('salta al siguiente de la lista', abiertos[0] === 2);
  // El validado se salta: ya está hecho y pararse en él sería perder el hilo.
  sandbox.AH_F.estado.length = 0;
  abiertos = [];
  sandbox.ahSiguiente(2);
  await new Promise((r) => setTimeout(r, 10));
  check('...y se salta los ya validados', abiertos[0] === 4);
  // Al llegar al final vuelve a dar la vuelta, en vez de dejar la pantalla muerta.
  abiertos = [];
  sandbox.ahSiguiente(4);
  await new Promise((r) => setTimeout(r, 10));
  check('al llegar al final vuelve al primero pendiente', abiertos[0] === 1);

  console.log('\n7. El detalle muestra lo que hace falta para decidir');
  await sandbox.ahAbrir(2);
  var det = nodo('ahDetalle').innerHTML;
  check('el título y la obra', det.indexOf('Patas cortas') > 0 && det.indexOf('SANTOLAYA') > 0);
  // LA CAUSA SE ELIGE EN EL MISMO MODAL DE RECLAMOS, no en un select propio. La fila
  // es la misma que allá: el texto, la lupa y la equis.
  check('la causa que trae se muestra como en Reclamos: [código] categoría > sub-causa',
    det.indexOf('value="[MO06] Mano de Obra &gt; Error al digitar o transcribir datos"') > 0
    || det.indexOf('value="[MO06] Mano de Obra > Error al digitar o transcribir datos"') > 0);
  check('...y se avisa que viene de planilla y falta validarla',
    det.indexOf('falta validarlo') > 0);
  check('hay lupa para abrir el modal y equis para quitar la causa',
    det.indexOf('id="ahCausaBuscar"') > 0 && det.indexOf('id="ahCausaQuitar"') > 0);
  check('no hay un select propio de causas', det.indexOf('<optgroup') < 0 && det.indexOf('id="ahCausa"') < 0);
  // El modal devuelve la elección por window.ahCausaElegida y la pantalla la toma.
  sandbox.window.ahCausaElegida({ categoria: 'metodo', cod_causa: 'MD01', sub_causa: 'No se indica en procedimiento estandarizado' });
  check('lo que el modal devuelve queda como causa a guardar',
    sandbox.AH.causaSel.cod_causa === 'MD01' && nodo('ahCausaDisplay').value.indexOf('[MD01]') === 0);
  check('...y el modal sabe desde dónde se abrió: área y selección actual',
    sandbox.window.ahIshikawa().cod_causa === 'MD01' && 'area_id' in sandbox.window.ahIshikawa());
  await sandbox.ahAbrir(1);
  check('un reclamo con kilos los muestra',
    nodo('ahDetalle').innerHTML.indexOf('180 kg') > 0);
  check('...y uno sin causa arranca con el display vacío', sandbox.AH.causaSel === null);

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
