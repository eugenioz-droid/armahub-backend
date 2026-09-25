// Test de LÓGICA (sin navegador) para dos invariantes de la grilla del creador de despieces:
//
//   1) El FONDO de una fila sale de UNA sola escala de prioridades (ac2EstiloFila):
//        inválida > seleccionada (masiva) > blanco.
//      Desde el 25-ago el fondo NO dice ni origen ni estado: el azul del Enfierrador y el
//      verde de "guardada" se retiraron a pedido del usuario («que ese fondo sea siempre
//      el mismo… no necesitamos mas ruido»). Quedan solo dos, y las dos son transitorias
//      y accionables. El origen lo dice el DIBUJO de la barra; el estado de guardado, el
//      contador del boton de guardar.
//      Existe porque la fila la pintan TRES caminos distintos (render completo, edición de una
//      medida y marcado masivo). Cuando cada uno traía su propia lista, uno se quedaba atrás y
//      el fondo mentía: el rosado "inválida" quedaba pegado tras corregir la barra. Si alguien
//      vuelve a escribir un color a mano en uno de los tres caminos, esta escala se rompe y
//      este test lo dice.
//
//   2) "Barra de estructura" se decide por el VÍNCULO a la instancia (_instanciaId), no por la
//      etiqueta _origen. En esa columna conviven 'template' (histórico) y 'enfierrador' (nuevo);
//      mirar el origen dejaba fuera del candado a barras que sí pertenecen a una estructura y
//      que la próxima regeneración va a pisar.
//
// No corre en producción, no toca la app. Correr con:
//   node tests/test_fila_colores.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Cargar el módulo del creador en un sandbox con stubs mínimos de navegador ──
const SRC = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'cubicacion', 'agregar_cubicacion2.js');
const code = fs.readFileSync(SRC, 'utf8');

const noop = () => {};
const fakeEl = { style: {}, textContent: '', value: '', checked: false, indeterminate: false,
                 innerHTML: '', className: '', appendChild: noop, addEventListener: noop,
                 setAttribute: noop, getAttribute: () => null, focus: noop, select: noop,
                 classList: { add: noop, remove: noop, toggle: noop } };
const documentStub = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => Object.assign({}, fakeEl),
  body: Object.assign({}, fakeEl),
};
const sandbox = { console, window: {}, document: documentStub, setTimeout: (fn) => fn && fn() };
sandbox.window.document = documentStub;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'agregar_cubicacion2.js' });

const AC2 = sandbox.AC2;
const ac2EstiloFila = sandbox.ac2EstiloFila;
const ac2BarraDeEstructura = sandbox.ac2BarraDeEstructura;

// ── Mini framework de aserciones ──
let fallos = 0;
function check(nombre, cond) {
  if (cond) { console.log('  ✓ ' + nombre); }
  else { console.log('  ✗ ' + nombre); fallos++; }
}
function bg(b) { return ac2EstiloFila(b).bg; }

// En el sandbox el catálogo de figuras está vacío → una figura "no usa" ningún lado:
//   con figura y SIN medidas  → válida
//   con figura y CON una medida → inválida (sobra esa medida)
const VALIDA  = { figura: 'F' };
const INVALIDA = { figura: 'F', dim_b: 10 };

// ── 1. Escala de prioridades del fondo ──────────────────────────────────────
console.log('\n1. Prioridad de colores de fila');
AC2.masiva = false; AC2.seleccion = {};

check('barra nueva (nada especial) → sin fondo',
      bg(Object.assign({ _id: 1 }, VALIDA)) === '');
// EL FONDO ES UNICO: BLANCO (25-ago). Aca se exigia el verde #f1f8e9 de "ya
// guardada"; el usuario lo retiro: «creo que esta bien que ese fondo sea siempre el
// mismo… no necesitamos mas ruido». Lo que queda pintando fila son solo cosas
// TRANSITORIAS y accionables (geometria mal, seleccion en masiva); el ESTADO de
// guardado lo dice el contador del boton de guardar, no un color por fila.
check('barra guardada → tambien BLANCA: el fondo ya no dice estado',
      bg(Object.assign({ _id: 2, _guardada: true }, VALIDA)) === '');
// LA BARRA DEL 3D NO PINTA SU FILA (cambio del 25-ago). Antes se llevaba un #e1f5fe
// propio; el usuario lo probó y lo sacó: «el fondo azul de la fila eso sí no me gusta,
// déjalo blanco nomás». Y tiene razón de fondo: la fila ya lleva TRES marcas para lo
// mismo —el DIBUJO en azul, la insignia 3D y los campos deshabilitados— sobre una
// escala de fondos que ya tenía rosado, celeste y verde. Lo que se queda es el TÍTULO,
// que es el que dice CÓMO se edita.
check('barra del Enfierrador → SIN fondo propio (se distingue por el dibujo y el 3D)',
      bg(Object.assign({ _id: 3, _instanciaId: 77 }, VALIDA)) === '');
// …Y BLANCA TAMBIÉN CUANDO ESTÁ GUARDADA. Al sacar el azul se dejó caer a la cascada y
// aterrizaba en el verde de "guardada"; el usuario lo vio y lo corrigió: «el color verde
// no me encantó, antes era blanco». Tiene sentido: ese verde contesta «¿alcancé a
// guardar lo que estoy tecleando?», y una barra del 3D nunca se teclea — nace guardada.
check('…y sigue BLANCA aunque esté guardada (el verde no le informa nada: nace guardada)',
      bg(Object.assign({ _id: 4, _instanciaId: 77, _guardada: true }, VALIDA)) === '');
check('pero sigue explicando en su título que se edita reabriendo su estructura',
      /reabriendo su estructura/.test(ac2EstiloFila(Object.assign({ _id: 4, _instanciaId: 77 }, VALIDA)).tit));
check('barra inválida → rosado #fff5f5 aunque venga del Enfierrador y esté guardada',
      bg(Object.assign({ _id: 5, _instanciaId: 77, _guardada: true }, INVALIDA)) === '#fff5f5');

AC2.masiva = true; AC2.seleccion = { 6: true, 7: true };
check('seleccionada en masiva → celeste #e3f2fd (lo que el usuario tiene marcado SI se ve)',
      bg(Object.assign({ _id: 6, _instanciaId: 77, _guardada: true }, VALIDA)) === '#e3f2fd');
check('seleccionada PERO inválida → manda el rosado (el error no se esconde)',
      bg(Object.assign({ _id: 7, _instanciaId: 77 }, INVALIDA)) === '#fff5f5');
AC2.masiva = false; AC2.seleccion = {};

check('la fila con problema explica el problema en su título',
      /Geometría inválida/.test(ac2EstiloFila(Object.assign({ _id: 8 }, INVALIDA)).tit));
check('la fila del Enfierrador explica que se edita reabriendo su estructura',
      /Enfierrador/.test(ac2EstiloFila(Object.assign({ _id: 9, _instanciaId: 77 }, VALIDA)).tit));

// ── 2. El candado sigue al vínculo, no a la etiqueta ────────────────────────
console.log('\n2. Predicado "barra de estructura"');
check("origen 'template' (histórico) con instancia → es de estructura",
      ac2BarraDeEstructura({ _origen: 'template', _instanciaId: 5 }) === true);
check("origen 'enfierrador' (nuevo) con instancia → es de estructura",
      ac2BarraDeEstructura({ _origen: 'enfierrador', _instanciaId: 5 }) === true);
check('sin etiqueta de origen pero CON instancia → sigue siendo de estructura',
      ac2BarraDeEstructura({ _origen: '', _instanciaId: 5 }) === true);
check("origen 'template' SIN instancia → NO es de estructura (no hay a qué reabrir)",
      ac2BarraDeEstructura({ _origen: 'template', _instanciaId: null }) === false);
check('barra manual → no es de estructura',
      ac2BarraDeEstructura({ _origen: 'manual' }) === false);
check('sin barra → false (no revienta)',
      ac2BarraDeEstructura(null) === false);

// ── 3. El DIBUJO también es azul, no sólo el fondo de la fila ───────────────
// Pedido del usuario (25-ago): «lo que dejaste en azul es el fondo pero me refería
// al RENDER». El color entra al motor de dibujo por parámetro —el dibujante no sabe
// de dónde salió la barra— y quien decide es esta grilla. Se congela que:
//   · el criterio es el MISMO que el del fondo de fila (ac2BarraDeEstructura, que
//     mira el vínculo y no la etiqueta): dos definiciones de "barra del 3D" en la
//     misma pantalla serían dos verdades;
//   · el hex no está escrito acá sino NOMBRADO (disenadorMotor.TINTA_3D), porque el
//     usuario avisó que va a querer probar otros tonos y eso tiene que ser una línea.
console.log('\n3. La tinta del dibujo sigue al mismo criterio que el fondo');
const fs3 = require('fs');
const src3 = fs3.readFileSync(SRC, 'utf8');
const lineaTinta = src3.split(/\r?\n/).filter(function (l) { return /color:\s*\(ac2BarraDeEstructura/.test(l); });
check('la grilla le pasa una tinta al motor de dibujo', lineaTinta.length === 1);
check('y la elige con ac2BarraDeEstructura, el MISMO predicado que pinta el fondo',
      lineaTinta.length === 1 && /ac2BarraDeEstructura\(b\)/.test(lineaTinta[0]));
check('el azul va NOMBRADO (TINTA_3D), no escrito como hex suelto en la grilla',
      lineaTinta.length === 1 && /TINTA_3D/.test(lineaTinta[0]) && !/#[0-9a-fA-F]{6}/.test(lineaTinta[0]));
// Y el ladrillo se fue: era un emoji que hay que adivinar, y que la fuente del sistema
// puede no dibujar (un 🗑 invisible costó tres rondas). Ahora es una insignia de texto.
check('el botón que abre el 3D dice "3D" con letras, no un emoji de ladrillo',
      src3.indexOf('🧱') < 0 && /class="b3d/.test(src3));

// ── 4. Las filas se distinguen entre sí ─────────────────────────────────────
// HISTORIA. En agosto la línea entre filas estaba en #f0f0f0 y el usuario reportó que
// «está demasiado tenue»; se subió a un gris oscuro (#78909c) y este test congelaba que
// no volviera a un gris casi blanco. El 26-sep el usuario aprobó la maqueta de la grilla
// (static/demo/grilla_despiece.html) que cambia el MECANISMO: las filas se separan por
// CEBREADO (fondo alternado) y la línea fuerte pasa al encabezado de grupo, que es donde
// de verdad cambia algo. La línea por fila vuelve a ser tenue A PROPÓSITO, porque ya no es
// ella la que separa. Lo que se congela ahora es que el contraste siga existiendo: por
// el cebreado y por la línea de grupo. Si alguien quita el cebreado "porque la línea es
// muy clara", este test lo dice, y la respuesta es reponer el cebreado, no oscurecer.
console.log('\n4. Las filas se distinguen: cebreado + línea fuerte en el grupo');
const HTML3 = fs.readFileSync(path.join(__dirname, '..', 'armahub', 'templates', 'tabs', 'agregar_cubicacion2.html'), 'utf8');
const mSep = src3.match(/var AC2_TDS='[^']*border-top:1px solid (#[0-9a-fA-F]{6})/);
check('AC2_TDS define el borde de la fila', !!mSep);
const mCebra = HTML3.match(/#ac2_grid tbody tr:nth-child\(even\)([^{]*)\{\s*background:\s*(#[0-9a-fA-F]{6})/);
check('el CSS de la grilla cebra las filas pares (#ac2_grid … nth-child(even))', !!mCebra);
if (mCebra) {
  check('el cebreado se salta los encabezados de grupo (.ac2grupo)', /:not\(\.ac2grupo\)/.test(mCebra[1]));
  check('y se salta las filas que traen fondo de ESTADO (inválida, seleccionada): el estado manda',
        /:not\(\[style\]\)/.test(mCebra[1]));
  // La banda tiene que verse: distinta del blanco, pero suave (no es un resalte).
  const cl = parseInt(mCebra[2].slice(1, 3), 16) / 255;
  check('la banda es un tono distinto del blanco y suave (=' + mCebra[2] + ')', cl < 1 && cl > 0.9);
}
// La línea FUERTE vive en el encabezado de grupo: 2px, más gruesa que la de fila (1px).
const iGrp = src3.indexOf('function ac2GrupoHdr');
const srcGrp = iGrp >= 0 ? src3.slice(iGrp, iGrp + 2500) : '';
const mGrp = srcGrp.match(/class="ac2grupo"[^]*?border-top:2px solid (#[0-9a-fA-F]{6})/);
check('el encabezado de grupo lleva la línea fuerte (2px) y la clase ac2grupo', !!mGrp);
if (mGrp && mSep) {
  const clG = parseInt(mGrp[1].slice(1, 3), 16) / 255, clF = parseInt(mSep[1].slice(1, 3), 16) / 255;
  check('y es más oscura que la línea de fila (' + mGrp[1] + ' vs ' + mSep[1] + ')', clG < clF);
}

console.log(fallos ? '\n❌ ' + fallos + ' fallo(s)' : '\n✅ Todo OK');
process.exit(fallos ? 1 : 0);
