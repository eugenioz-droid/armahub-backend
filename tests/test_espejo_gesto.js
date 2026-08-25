// =============================================================================
// EL GESTO DE ESPEJAR — test headless (Node)
// =============================================================================
// El cálculo del espejo vive en el motor y lo congela test_espejo_componente.js.
// Acá se congela LO OTRO: el gesto de dos tiempos del editor, que es lo que el
// usuario aprieta.
//
// POR QUÉ DOS TIEMPOS. Una pieza puede espejarse contra tres planos distintos y el
// editor no puede adivinar cuál quiere el usuario. Así que el botón ARMA y el clic
// en una CARA del hormigón decide el eje —explícito, sin inferencias—. Eso también
// contesta la duda del usuario: «para las barras distribuidas en otros sentidos se
// puede enredar el comando, se necesita algún tipo de discriminante». El
// discriminante es la cara que se clica.
//
// QUÉ PROTEGE:
//   A. SIN SELECCIÓN, ARMA Y ESPERA — apretar el botón sin barra elegida no es un
//      error: pide la barra y sigue armado.
//   E+F. EL ORDEN NO IMPORTA — botón y después barra llega al mismo lugar que barra
//      y después botón, y un clic en una cara sin barra elegida no tumba el modo.
//   B. EL GESTO COMPLETO — armar, clic en una cara, y aparece la copia espejada
//      justo después del original, seleccionada, con el modo ya apagado.
//   C. SE PUEDE SALIR — Esc / volver a apretar el botón desarma sin crear nada.
//   D. UN CLIC, UNA COPIA — el modo se consume: el clic siguiente no espeja otra
//      vez (era el defecto del modo colocar antes de que se apagara solo).
//
// Correr con: node tests/test_espejo_gesto.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const clon = (o) => JSON.parse(JSON.stringify(o));

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_cotas_vivas.js: acá se prueban la CUENTA y la
// ESCRITURA, que son funciones sobre la receta; el DOM real no hace falta.
function El() {
  this.style = {}; this.dataset = {}; this.children = []; this.className = ''; this.value = '';
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.setAttribute = function () {}; El.prototype.getAttribute = function () { return null; };
El.prototype.addEventListener = function () {}; El.prototype.removeEventListener = function () {};
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };

const win = {};
win.window = win; win.self = win;
win.document = {
  body: new El(), documentElement: new El(), head: new El(),
  createElement: () => new El(), createElementNS: () => new El(), createTextNode: () => new El(),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}
};
win.console = console;
win.JSON = JSON; win.Math = Math; win.Date = Date; win.Object = Object; win.Array = Array;
win.Number = Number; win.String = String; win.Boolean = Boolean; win.isFinite = isFinite;
win.parseFloat = parseFloat; win.parseInt = parseInt; win.isNaN = isNaN; win.Error = Error;
win.Promise = Promise; win.RegExp = RegExp;
win.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
win.navigator = { userAgent: 'node' };
win.location = { href: 'http://x/', origin: 'http://x' };
win.fetch = () => Promise.reject(new Error('sin red'));
win.alert = () => {}; win.confirm = () => false;
win.setTimeout = () => 0; win.clearTimeout = () => {};
win.setInterval = () => 0; win.clearInterval = () => {};
win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
win.addEventListener = () => {}; win.removeEventListener = () => {};
win.getComputedStyle = () => ({});
win.devicePixelRatio = 1; win.innerWidth = 1200; win.innerHeight = 800;

const ctx = vm.createContext(win);
function mod(file, nombre) {
  const src = fs.readFileSync(path.join(BASE, file), 'utf8');
  const m = { exports: {} };
  vm.runInContext('(function(module, exports, require, global){' + src + '\n})', ctx, { filename: file })(m, m.exports, require, win);
  if (nombre) win[nombre] = m.exports;
  return m.exports;
}
mod('catalogo_figuras.js', 'ModeladorCatalogoFiguras');
mod('figura_puntos.js', 'ModeladorFiguraPuntos');
mod('motor_geom.js', 'ModeladorMotorGeom');
mod('reglas.js', 'ModeladorReglas');
mod('generar.js', 'ModeladorGenerar');
mod('semilla_viga.js', 'ModeladorSemilla');
vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });

const R = win.ModeladorReglas;
const G = win.ModeladorGenerar;
const TE = win.TemplateEditor;
const ST = TE._ST;

const MURO = { largo: 600, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };

function estribo() {
  return {
    comp_id: 'EC1', tipologia: 'EC', figura: '104D', diam: 8, jerarquia: 1,
    modo: 'puntual', plano_pieza: { volteado: false },
    pose: { cara: 'sup', lado: 1, rumbo: 'z' },
    dims: { A: { modo: 'fija', valor: 40 }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' },
    pos_hint: { x: -250 }
  };
}
function montar(n) {
  const comps = [];
  for (let i = 0; i < (n || 1); i++) {
    const c = estribo();
    c.comp_id = 'EC' + (i + 1);
    c.pos_hint = { x: -250 + i * 40 };
    comps.push(c);
  }
  ST.receta = { tipo: 'muro', geometria: Object.assign({}, MURO), componentes: comps };
  ST.selCi = -1; ST.selExtra = []; ST.ultimoOut = null; ST.espejoPend = false;
  R.normalizarReceta(ST.receta);
  regen();
}
function regen() {
  R.reanclarReceta(ST.receta);
  const out = G.generarElemento(ST.receta);
  (out.placements || []).forEach((pl) => { pl.meta = pl.meta || {}; pl.meta.ci = 0; });
  ST.ultimoOut = out;
}
// La CARA que el usuario clica. En el editor sale de _facesDeVista; acá se pasa
// directo porque lo que se prueba es qué hace el editor CON ella, no cómo se elige.
const CARA_TESTERO = { cara: 'extremo', axis: 'x', sign: 1, edge: 'right', orient: 'v' };
const nComp = () => ST.receta.componentes.length;

// ============================================ A · SIN SELECCIÓN, ARMA Y ESPERA
// (25-ago) Antes NO armaba y se quedaba mudo: el usuario apretaba el botón, elegía
// la barra y no pasaba nada — «así que nada ocurre». Una herramienta se aprieta
// primero y se usa después, como el resto del editor, así que el modo arma igual y
// espera lo que falte.
console.log('A · el botón sin barra seleccionada arma y espera');
{
  montar();
  TE._armarEspejo();
  ok(ST.espejoPend === true, 'queda armado esperando la barra');
  ok(nComp() === 1, 'y no creó nada');
}

// ============================================================ B · EL GESTO COMPLETO
console.log('');
console.log('B · armar, clic en la cara, aparece la copia');
{
  montar();
  ST.selCi = 0;
  TE._armarEspejo();
  ok(ST.espejoPend === true, 'con una barra elegida el botón sí arma');

  TE._espejarEnCara(CARA_TESTERO);
  ok(nComp() === 2, 'el clic en la cara creó la copia (=' + nComp() + ')');
  ok(ST.selCi === 1, 'y la dejó seleccionada, justo después del original');
  ok(ST.espejoPend === false, 'el modo se apagó solo: es de un clic');

  const a = ST.receta.componentes[0], b = ST.receta.componentes[1];
  ok(b.tipologia === a.tipologia && b.figura === a.figura && b.diam === a.diam,
    'la copia es una copia: misma tipología, figura y diámetro');
  ok(JSON.stringify(b.dims) === JSON.stringify(a.dims), '…y las mismas medidas: un espejo no cambia largos');
  ok(b !== a, 'y es otro objeto, no una referencia');
}

// ================================================================ C · SE PUEDE SALIR
console.log('');
console.log('C · desarmar sin crear nada');
{
  montar();
  ST.selCi = 0;
  TE._armarEspejo();
  TE._salirEspejo();
  ok(ST.espejoPend === false, 'sale del modo');
  ok(nComp() === 1, 'sin haber creado nada');
}

// ============================================================ D · UN CLIC, UNA COPIA
console.log('');
console.log('D · el modo se consume: un clic, una copia');
{
  montar();
  ST.selCi = 0;
  TE._armarEspejo();
  TE._espejarEnCara(CARA_TESTERO);
  const tras1 = nComp();
  // Un segundo clic en la vista, con el modo YA apagado, no puede espejar de nuevo.
  ok(ST.espejoPend === false, 'tras espejar el modo está apagado');
  ok(tras1 === 2, 'y hay exactamente una copia (=' + tras1 + ')');
}

// ===================================================== E . EL ORDEN NO IMPORTA
// (25-ago) La primera version exigia elegir la barra ANTES de apretar el boton: sin
// seleccion no armaba y se quedaba muda. El usuario hizo lo natural -"presiono el
// boton, selecciono un componente y no aparecen las ayudas ni nada, asi que nada
// ocurre"-, porque una herramienta se aprieta primero y se usa despues, como el
// resto del editor.
console.log('');
console.log('E . apretar el boton primero y elegir la barra despues');
{
  montar();
  TE._armarEspejo();
  ok(ST.espejoPend === true, 'arma aunque no haya nada seleccionado');
  ok(nComp() === 1, 'sin crear nada, claro');

  ST.selCi = 0;                      // el usuario elige la barra con el modo ya armado
  ok(ST.espejoPend === true, 'elegir la barra no lo desarma');
  TE._espejarEnCara(CARA_TESTERO);
  ok(nComp() === 2, 'y el clic en la cara espeja igual que por el otro camino');
  ok(ST.espejoPend === false, 'dejando el modo apagado');
}

// ======================================== F . SIN BARRA ELEGIDA NO ESPEJA NADA
console.log('');
console.log('F . con el modo armado pero sin barra, el clic en una cara no crea nada');
{
  montar();
  TE._armarEspejo();
  ST.selCi = -1;
  TE._espejarEnCara(CARA_TESTERO);
  ok(nComp() === 1, 'no se creo ninguna copia');
  ok(ST.espejoPend === true, 'y el modo sigue esperando la barra, no se cae');
}

// ================================================== G . SELECCION MULTIPLE
// (25-ago) El caso real del usuario son CUATRO componentes por extremo del muro
// -dos de cabezales con dos capas cada uno y dos de estribos de confinamiento- y
// espejarlos de a uno era justo el trabajo que esta funcion vino a sacar. Ctrl+clic
// suma y quita; `selCi` sigue siendo LA seleccion (la que muestra la ficha) y los
// demas van de acompanantes.
console.log('');
console.log('G . ctrl+clic suma y quita');
{
  montar(4);
  TE._seleccionar(0);
  ok(TE._selTodos().length === 1, 'un clic normal deja una sola');
  TE._alternarSeleccion(2);
  TE._alternarSeleccion(3);
  ok(TE._selTodos().join(',') === '3,2,0', 'ctrl+clic suma (=' + TE._selTodos().join(',') + ')');
  ok(ST.selCi === 0, 'y la principal no cambia: es la que muestra la ficha');
  ok(TE._estaSeleccionado(2) === true && TE._estaSeleccionado(1) === false, 'el resaltado sabe cuales son');

  TE._alternarSeleccion(2);
  ok(TE._selTodos().join(',') === '3,0', 'ctrl+clic sobre una ya elegida la quita (=' + TE._selTodos().join(',') + ')');
  TE._alternarSeleccion(0);
  ok(ST.selCi === 3 && TE._selTodos().join(',') === '3', 'quitar LA principal le cede el puesto a un acompanante');

  TE._seleccionar(1);
  ok(TE._selTodos().join(',') === '1', 'un clic normal SUSTITUYE, no amplia');
}

// ============================================ H . ESPEJAR VARIAS DE UNA VEZ
console.log('');
console.log('H . el espejo toma todas las seleccionadas');
{
  montar(4);
  TE._seleccionar(0);
  TE._alternarSeleccion(1);
  TE._alternarSeleccion(2);
  const antes = nComp();
  TE._armarEspejo();
  TE._espejarEnCara(CARA_TESTERO);
  ok(nComp() === antes + 3, 'salieron tres copias, una por cada seleccionada (=' + nComp() + ')');
  ok(TE._selTodos().length === 3, 'y la seleccion paso a las copias (=' + TE._selTodos().length + ')');
  ok(ST.espejoPend === false, 'con el modo apagado');
  // cada copia quedo detras de SU original: 0->1, 2->3, 4->5 tras los tres splices
  const ids = ST.receta.componentes.map(function (c) { return c.comp_id; });
  ok(ids[0] === ids[1] && ids[2] === ids[3] && ids[4] === ids[5],
    'cada copia esta pegada a su original (=' + ids.join(' ') + ')');
  ok(ids[6] === 'EC4', 'y la que no estaba seleccionada quedo intacta al final');
}

// ================================================ I . BORRAR VARIAS DE UNA VEZ
console.log('');
console.log('I . borrar toma todas las seleccionadas');
{
  montar(4);
  TE._seleccionar(1);
  TE._alternarSeleccion(3);
  TE._borrarSeleccion();
  const ids = ST.receta.componentes.map(function (c) { return c.comp_id; });
  ok(ids.join(',') === 'EC1,EC3', 'se fueron las dos elegidas y solo esas (=' + ids.join(',') + ')');
  ok(TE._selTodos().length === 0, 'y no queda nada seleccionado');
}

// ============================ J . LO QUE MUEVE LA LISTA SUELTA LOS ACOMPANANTES
// Son INDICES: uno que sobrevive a un splice apunta a otra barra. Antes que
// arrastrar indices podridos -y espejar o borrar la barra equivocada- se suelta.
console.log('');
console.log('J . duplicar suelta los acompanantes');
{
  montar(4);
  TE._seleccionar(0);
  TE._alternarSeleccion(3);
  ok(TE._selTodos().length === 2, 'dos elegidas antes de duplicar');
  TE._duplicar(0);
  ok(TE._selTodos().length === 1, 'tras duplicar queda una sola: los indices se corrieron');
}

// ================================================== K . SHIFT+CLIC TOMA UN TRAMO
console.log('');
console.log('K . shift+clic en la tira toma un tramo entero');
{
  montar(5);
  TE._seleccionar(1);
  TE._seleccionarTramo(3);
  ok(TE._selTodos().join(',') === '3,2,1', 'de la 1 a la 3 (=' + TE._selTodos().join(',') + ')');
  ok(ST.selCi === 1, 'la principal no se mueve: sigue siendo la que muestra la ficha');
  TE._seleccionarTramo(0);
  ok(TE._selTodos().join(',') === '1,0', 'y hacia atras tambien (=' + TE._selTodos().join(',') + ')');
}

// ============================== L . SIN NADA ELEGIDO NO SE RESALTA MEDIA VISTA
// El `ci < 0` es el placement sin componente. Antes lo filtraba el `ST.selCi >= 0`
// que cada sitio de resaltado llevaba pegado; al centralizar la pregunta habia que
// traerse el filtro, o con NADA seleccionado esas barras se pintaban como elegidas.
console.log('');
console.log('L . el resaltado no toma las barras sin componente');
{
  montar(3);
  TE._seleccionar(-1);
  ok(TE._estaSeleccionado(-1) === false, 'ci -1 no esta seleccionado aunque selCi valga -1');
  ok(TE._estaSeleccionado(0) === false, 'y sin seleccion no hay ninguna marcada');
}

// ================== M . CON VARIAS ELEGIDAS LA FICHA NO SE ABRE
// (25-ago) El usuario: "el panel de la izquierda me muestra una tipologia, pero
// tengo 2 seleccionadas. A cual le hara los cambios? Ahi deberia aparecer algo
// distinto para no ponerme a editar sin control". La ficha edita SIEMPRE a la
// principal, asi que con varias elegidas se cambia el panel entero por la lista de
// lo que hay elegido y las acciones que si son plurales.
console.log('');
console.log('M . el panel de la seleccion multiple');
{
  montar(4);
  TE._seleccionar(0);
  TE._alternarSeleccion(2);
  TE._alternarSeleccion(3);
  const panel = TE._detalleMultiple(TE._selTodos());
  ok(!!panel, 'se arma sin reventar');
  const filas = [];
  (function hojas(n) {
    (n.children || []).forEach(function (h) {
      if (h.className === 'te-multi-fila') filas.push(h);
      hojas(h);
    });
  })(panel);
  ok(filas.length === 3, 'una fila por barra elegida (=' + filas.length + ')');
}

// ============ N . EL CHECK DE CAPAS ANIDADAS SOLO SE OFRECE DONDE HACE ALGO
// (25-ago) El usuario: "ajustar las capas anidadas no hace nada". Y era cierto EN
// SU CASO: el anidado acorta las PATAS de la capa de adentro para que no choquen
// con la de afuera, y una barra recta no tiene patas que acortar. El check no
// estaba roto: estaba ofrecido donde no aplica, que para el usuario es lo mismo.
console.log('');
console.log('N . el anidado se ofrece donde cambia algo');
{
  ST.receta = { tipo: 'viga', geometria: { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 }, componentes: [] };
  function capas(figura, dims) {
    return {
      comp_id: 'C1', tipologia: 'CB', figura: figura, diam: 16, jerarquia: 2, modo: 'puntual',
      pose: { cara: 'sup', lado: 1, rumbo: 'x' }, dims: dims,
      distribucion: { modo: 'layered', n_capas: 2, barras_capa: 2, gap: 30, sentido: 'nucleo' }
    };
  }
  const recta = capas('101A', { A: { modo: 'auto' } });
  const conPatas = capas('103B', { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' } });
  ST.receta.componentes = [recta, conPatas];
  R.normalizarReceta(ST.receta);
  ok(TE._anidadoCambiaAlgo(ST.receta.componentes[0]) === false,
    'una barra recta no tiene patas que acortar: el check no se ofrece');
  ok(TE._anidadoCambiaAlgo(ST.receta.componentes[1]) === true,
    'una figura con patas si anida: el check se ofrece');
}

// ============ O . LA COLOCACION NO DEPENDE DE LA TIPOLOGIA
// (25-ago) Hubo un override que hacia que la traba ignorara la regla general para
// que cruzara el espesor viniera de donde viniera. El usuario lo corto: "la
// tipologia NO DECIDE LA COLOCACION. La logica de insercion debe ser siempre la
// misma. Con cualquier barra tendras un caso mal insertado si elegimos mal la vista
// o la cara: por eso el usuario debe tener el control".
// La regla es una sola: la barra nace en el plano de la vista donde se clico. Este
// bloque existe para que nadie vuelva a meterle una excepcion a una tipologia.
console.log('');
console.log('O . la vista manda, la tipologia no');
{
  ST.receta = { tipo: 'muro', geometria: Object.assign({}, MURO), componentes: [] };
  ST.elemento = 'muro'; ST.caraHi = null; ST.espejoColoc = false;
  function rumboDe(tip, plano) {
    return R.poseDe(TE._compDesdeClick(plano, { x: 0, y: 0, z: 8 }, { tipologia: tip, figura: '103B', diam: 8 })).rumbo;
  }
  // La PROFUNDIDAD de cada cuadrante del muro (el eje que sale de la pantalla),
  // escrita a mano porque es el dato contra el que se compara: una barra que naciera
  // apuntando ahi seria invisible en la vista donde el usuario la esta poniendo.
  const FONDO = { seccion: 'y', largo: 'z', planta: 'x' };
  ['seccion', 'largo', 'planta'].forEach(function (plano) {
    const r = rumboDe('TR', plano);
    ok(r !== FONDO[plano],
      'clic en ' + plano + ': la traba NO nace apuntando al fondo de esa vista (rumbo=' + r + ', fondo=' + FONDO[plano] + ')');
  });
  // Y la traba no tiene privilegios: cambiar de vista le cambia el rumbo igual que
  // a cualquier otra barra.
  ok(rumboDe('TR', 'seccion') !== rumboDe('TR', 'largo'),
    'la traba sigue a la vista como todas (' + rumboDe('TR', 'seccion') + ' vs ' + rumboDe('TR', 'largo') + ')');
  ok(rumboDe('MH', 'seccion') !== rumboDe('MH', 'planta'),
    'una malla tambien (' + rumboDe('MH', 'seccion') + ' vs ' + rumboDe('MH', 'planta') + ')');
}

// ================== P . EL ESPESOR DEL CORTE (la rebanada del slider)
// (25-ago) "Los sliders funcionan super bien y hoy muestran exactamente el corte de
// cuchillo, sin embargo a veces se me pierden detalles por que tenemos elementos que
// no quedan en la misma linea: seria ideal poder proponer que ese slider tenga una
// profundidad." El corte YA era una banda de dos planos; lo que faltaba era dar su
// espesor como control. Un solo valor para las tres vistas: el DONDE se corta es de
// cada cuadrante, el CUANTO se ve es una sola decision.
console.log('');
console.log('P . el espesor del corte');
{
  ST.corteEspesor = null;
  ok(TE._semiEspesorCorte(30) === null, 'sin fijar nada sigue el automatico de siempre');

  ST.corteEspesor = 20;
  ok(TE._semiEspesorCorte(30) === 10,
    'el control habla en rebanada COMPLETA y el motor en semi: 20 -> 10 (=' + TE._semiEspesorCorte(30) + ')');

  ST.corteEspesor = 500;
  ok(TE._semiEspesorCorte(30) === 30,
    'pedir mas profundidad que el elemento se acota a el (=' + TE._semiEspesorCorte(30) + ')');

  ST.corteEspesor = 0;
  ok(TE._semiEspesorCorte(30) === null, 'un cero no deja el corte en nada: vuelve al automatico');
  ST.corteEspesor = null;
}

// ============== Q . LA AMPOLLETA APAGA EL DIBUJO, NUNCA EL CALCULO
// (25-ago) El usuario pregunto lo correcto antes de que existiera: "si tengo
// jerarquias y apago un componente, eso no va a generar una modificacion de la
// posicion de esa componente?". MEDIDO en una viga 600x60x30: sacar de la RECETA el
// cabezal de nivel 1 sube al de nivel 2 de y=23,6 a y=24,4 -medio diametro de fi16-,
// y con eso cambian los kilos. Por eso apagar no toca la generacion: la receta se
// expande completa y lo unico que se salta es construir la malla.
//
// Y apagar es de VISTA, no de la receta: el campo es NO ENUMERABLE para que no se
// guarde en el template. Apagar una barra para mirar otra no puede llegarle apagada
// al que abra el template manana.
console.log('');
console.log('Q . la ampolleta');
{
  montar(3);
  const c = ST.receta.componentes[1];
  ok(TE._ocultoComp(c) === false, 'una barra nace encendida');

  TE._setOcultoComp(c, true);
  ok(TE._ocultoComp(c) === true, 'se apaga');
  ok(TE._ocultoCi(1) === true, 'y se sabe por indice, que es como lo pregunta el dibujo');
  ok(TE._nOcultos() === 1, 'la tira sabe cuantas hay apagadas (=' + TE._nOcultos() + ')');

  // LO QUE NO PUEDE PASAR: que viaje al template guardado.
  const guardado = JSON.parse(JSON.stringify(ST.receta));
  ok(guardado.componentes[1]._oculto === undefined,
    'apagada NO se guarda en la receta: es estado de vista');

  // …y la generacion sigue emitiendo TODAS las barras, apagadas incluidas: apagar no
  // toca la receta, asi que el motor emite exactamente lo mismo.
  regen();
  const conApagada = (ST.ultimoOut.placements || []).length;
  TE._setOcultoComp(c, false);
  regen();
  const conEncendida = (ST.ultimoOut.placements || []).length;
  ok(conApagada === conEncendida && conApagada > 0,
    'el motor emite las mismas barras con el componente apagado y encendido (=' + conApagada + ')');
  TE._setOcultoComp(c, true);

  TE._encenderTodas();
  ok(TE._nOcultos() === 0, 'y se pueden prender todas de una');
}

// ============ R . LA COLOCACION ES LA MISMA PARA TODAS LAS TIPOLOGIAS
// (25-ago) La regla del usuario: el lado dominante queda paralelo al borde que se
// clico. Se cumplia en cinco de las seis tipologias. EC -y ES/ESC- se salia, porque
// la pregunta "esta pieza se muestra de frente en la vista?" tenia una segunda mitad
// que preguntaba por TIPOLOGIA: rol estribo + esPiezaDeSeccion es verdadero para
// CUALQUIER figura puesta con EC, asi que una figura abierta nacia apuntando al fondo
// y se veia como un punto. Ahora la pregunta es TOPOLOGICA: se muestra de frente lo
// que encuadra una seccion -cerrada, o cadena de 4+ lados-.
console.log('');
console.log('R . el borde clicado manda igual en todas las tipologias');
{
  const TIPS = ['MH', 'MV', 'EC', 'TC', 'TR', 'CB'];
  function poseCon(tip, fig, plano, borde) {
    ST.elemento = 'muro';
    ST.receta = { tipo: 'muro', geometria: Object.assign({}, MURO), componentes: [] };
    ST.selCi = -1; ST.selExtra = []; ST.espejoColoc = false;
    const f = TE._facesDeVista(plano).filter(function (x) { return x.edge === borde; })[0];
    ST.caraHi = f ? { plano: plano, cara: f.cara, edge: f.edge, orient: f.orient,
                      axis: f.axis, sign: f.sign, pos: f.pos, a: f.a, b: f.b } : null;
    const c = TE._compDesdeClick(plano, { x: 0, y: 0, z: 8 }, { tipologia: tip, figura: fig, diam: 8 });
    ST.caraHi = null;
    return R.poseDe(c);
  }
  [['seccion','top'],['seccion','left'],['largo','top'],['largo','left'],['planta','bottom']].forEach(function (caso) {
    const poses = TIPS.map(function (t) { return poseCon(t, '103B', caso[0], caso[1]); });
    const uno = poses[0];
    const todas = poses.every(function (p) {
      return p.cara === uno.cara && p.lado === uno.lado && p.rumbo === uno.rumbo;
    });
    ok(todas, caso[0] + '/' + caso[1] + ': las seis tipologias colocan igual (' +
      uno.cara + '/' + uno.rumbo + ')');
  });
  // …y una figura CERRADA sigue mostrandose de frente, que es lo que ese camino
  // existe para sostener: eso lo decide su topologia, no con que tipologia se puso.
  const cerrada = poseCon('MH', '104D', 'largo', 'top');
  ok(cerrada.rumbo === 'z', 'una 104D bajo MH igual se muestra de frente en la elevacion (rumbo=' + cerrada.rumbo + ')');
  const cerrada2 = poseCon('EC', '104D', 'largo', 'top');
  ok(cerrada2.rumbo === cerrada.rumbo, '…y con EC exactamente igual: lo decide la figura');
}

// ========= S . LA BARRA NACE COMPLETA (el bug del 'Cantidad: 0')
// (25-ago) Con la CONFIG guardada preseteando una tipologia en 'arreglo', la barra
// nacia con comp.modo='arreglo' pero una distribucion linear inactiva SIN rangos:
// el generador despachaba por comp.modo -> arreglo -> 0 barras. El usuario la
// insertaba y no aparecia NADA; el preview caia al esquema generico (un punto). Y
// la ficha sembraba los rangos AL PINTARSE, asi que cualquier edicion la hacia
// aparecer 'sola'. El nacimiento ahora pasa por _setModoComp -el sembrador de los
// botones de modo- y la ficha ya no escribe mientras pinta.
console.log('');
console.log('S . la barra nace completa con el preset arreglo de la config');
{
  win.ModeladorConfig = { cargada: function () { return true; },
    modo: function () { return 'arreglo'; } };
  ST.elemento = 'muro';
  ST.receta = { tipo: 'muro', geometria: Object.assign({}, MURO), componentes: [] };
  ST.selCi = -1; ST.selExtra = []; ST.caraHi = null; ST.espejoColoc = false;
  const c = TE._compDesdeClick('largo', { x: 0, y: 0, z: 8 }, { tipologia: 'TC', figura: '103B', diam: 8 });
  ok(c.modo === 'arreglo' && c.distribucion.modo === 'arreglo',
    'modo del componente y de la distribucion coinciden (=' + c.modo + '/' + c.distribucion.modo + ')');
  ok(!!c.distribucion.rango && !!c.distribucion.rango2, 'nace con sus DOS rangos sembrados');
  ok(c.distribucion.activa === true, 'y activa');
  ST.receta.componentes = [c];
  R.normalizarReceta(ST.receta);
  regen();
  const n = (ST.ultimoOut.placements || []).length;
  ok(n > 0, 'genera barras INMEDIATAMENTE, sin esperar una edicion (=' + n + ')');
  win.ModeladorConfig = undefined;
}

console.log(fallos ? (fallos + ' FALLO(S)') : 'OK — el gesto de espejar está congelado');
process.exit(fallos ? 1 : 0);
