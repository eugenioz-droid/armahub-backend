// =============================================================================
// Modelador — MINIATURA DE SECCIÓN (columna «Sección» del Gestor de templates)
//
// QUÉ DIBUJA: el corte del elemento (ancho × alto), sus COTAS y un ESQUEMA del
// fierro, a partir del resumen compacto que manda GET /templates
// (modelador._resumen_seccion, ~50-120 bytes por fila):
//     { w:20, h:250, r:2.5, p:['t2x5p','t1x2h'] }
//
// POR QUÉ EXISTE ESTE DIBUJANTE Y NO SE REUSA disenadorMotor
// -----------------------------------------------------------------------------
// `disenadorMotor.svgDesdePuntos` dibuja una FIGURA — la forma doblada de UNA barra,
// a partir de su polilínea. Acá no hay polilínea que dibujar: lo que se pinta es una
// SECCIÓN, o sea el hormigón visto de punta con los grupos de barras situados contra
// sus caras. Son dos cosas distintas, y meterlas en el mismo motor obligaría a
// ramificarlo por «¿esto es una barra o un corte?».
//
// LA MINIATURA NO PUEDE MENTIR (y por eso hay dos verdades distintas acá)
// -----------------------------------------------------------------------------
//   · LAS COTAS SON DATO REAL: salen del hormigón de la receta. La cota dice 20×250
//     porque el template dice 20×250.
//   · EL DIBUJO ES UN ESQUEMA, y se dice con esa palabra en la columna y en el
//     tooltip (ver `titulo`), no con un asterisco al pie que nadie lee. Dos motivos,
//     ninguno disimulable:
//       - las POSICIONES de las barras las calcula el motor (ModeladorGenerar), que
//         es JS y no corre en el backend: el resumen dice cuántos grupos hay, con
//         cuántas barras y contra qué cara, no dónde queda cada barra al milímetro;
//       - la PROPORCIÓN va acotada (ver AR_MIN/AR_MAX): un muro 20×250 a escala fiel
//         es una tira de 5 px donde no se ve un solo fierro, y en 110 px la fidelidad
//         al milímetro no aporta nada.
//   · SIN RESUMEN NO SE INVENTA UNA SILUETA: `svg(null)` devuelve un hueco que lo
//     dice (ver `_hueco`). Una receta que no se puede dibujar tiene que verse como lo
//     que es.
//
// EL COLOR ENTRA POR PARÁMETRO (mismo trato que disenadorMotor.TINTA/TINTA_3D): el
// dibujante no sabe —ni tiene por qué— de dónde salió el template que le pasan.
//
// PINTAR NO ESCRIBE: `svg()` sólo LEE el resumen. Ya hubo un bug de un render que
// mutaba justo lo que estaba dibujando.
// =============================================================================
(function (global) {
  'use strict';

  // ---- LA TINTA, EN UN SOLO SITIO ----
  // Es el mismo teal que disenadorMotor.TINTA, y va REPETIDO a propósito en vez de
  // leerse de ahí: los scripts cargan en paralelo, así que el default dependería del
  // orden de carga (y en el test el dibujante corre en un sandbox pelado, sin el motor
  // del catálogo). Lo que importa es que sea UNA línea de ESTE archivo: quien llama
  // nombra el color, no lo escribe.
  var TINTA = '#00695c';           // el fierro
  var HORMIGON = '#eceff1';        // el relleno del corte
  var HORMIGON_BORDE = '#b0bec5';
  var COTA = '#78909c';            // líneas y números de cota
  var HUECO = '#b0bec5';           // el «no se puede dibujar»

  // Caja de trabajo dentro del viewBox: se reservan la izquierda para la cota del
  // alto y el pie para la del ancho. Van como PROPORCIÓN del tamaño pedido, así que
  // la miniatura se puede pedir más grande sin recalcular nada a mano.
  var M_IZQ = 0.165, M_DER = 0.045, M_ARR = 0.062, M_ABA = 0.225;
  // La cota del alto va PEGADA al canto izquierdo del hormigón (y no en una columna
  // fija): con una fija, un muro angosto —que se dibuja al medio— dejaba 40 px de
  // línea de referencia vacía cruzando la miniatura entera.
  var X_COTA_V = 0.055;            // cuánto se separa del canto la línea de cota del alto
  var Y_COTA_H = 0.075;            // cuánto baja la línea de cota del ancho

  // PROPORCIÓN ACOTADA — ver «LA MINIATURA NO PUEDE MENTIR» arriba.
  var AR_MIN = 0.30, AR_MAX = 3.2;

  // Separación mínima entre dos barras dibujadas. Un grupo con más barras de las que
  // caben se pinta con las que caben: a esta escala la diferencia entre 14 puntos y
  // 22 no es información, es un borrón (y el tooltip ya dice que es un esquema).
  var PASO_MIN = 3;
  var PASO_CAPA = 3.4;             // cuánto se separan las capas apiladas contra su cara
  var RADIO_PUNTO = 1.45;
  // Las barras CORTADAS se arriman por dentro del recubrimiento en vez de quedar
  // clavadas en él: en una sección de verdad el longitudinal va por dentro del marco
  // que lo abraza, y sin este arrimo el punto se dibuja ENCIMA de la línea del estribo
  // (o del borde del hormigón) y se pierde. Es medio diámetro de punto, no una medida.
  var ARRIMO = RADIO_PUNTO;

  // Un token del resumen: región + columnas + filas + forma. Lo que no calce con esto
  // NO se dibuja (no se adivina): el resumen es un contrato, no una sugerencia.
  var RE_TOKEN = /^([sit])(\d+)x(\d+)([pvhm])$/;

  function _n(v) { return Math.round(Number(v) * 100) / 100; }
  function _clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function _pos(v) { var n = Number(v); return (isFinite(n) && n > 0) ? n : null; }

  // Medida como se escribió: 20 y no 20.0, 2.5 y no 2.50. Es la cifra de la COTA, o
  // sea dato del usuario: no se le agregan decimales que él no puso.
  function _medida(v) {
    var n = Math.round(Number(v) * 10) / 10;
    return String(n === Math.round(n) ? Math.round(n) : n);
  }

  function _tok(t) {
    var m = RE_TOKEN.exec(String(t || ''));
    if (!m) return null;
    return { region: m[1], cols: parseInt(m[2], 10), filas: parseInt(m[3], 10), forma: m[4] };
  }

  // n posiciones repartidas entre a y b, con las de los extremos EN los extremos.
  // Con n = 1 va al centro: una sola cortina va al medio del muro y no pegada a una
  // cara — que es lo que hace el motor y lo que el usuario espera ver.
  function _reparto(n, a, b) {
    if (n <= 1) return [(a + b) / 2];
    var out = [], paso = (b - a) / (n - 1), i;
    for (i = 0; i < n; i++) out.push(a + i * paso);
    return out;
  }

  // Capas apiladas DESDE una cara hacia el núcleo (región 's' / 'i').
  function _pila(n, desde, hacia) {
    var largo = Math.abs(hacia - desde);
    var paso = Math.min(PASO_CAPA, n > 1 ? largo / (n - 1) : PASO_CAPA);
    var signo = (hacia >= desde) ? 1 : -1;
    var out = [], i;
    for (i = 0; i < n; i++) out.push(desde + signo * i * paso);
    return out;
  }

  // Cuántas barras de un grupo CABEN en un tramo. Ver PASO_MIN.
  function _caben(n, largo) {
    return Math.max(1, Math.min(n, Math.floor(largo / PASO_MIN) + 1));
  }

  function _linea(x1, y1, x2, y2, color, ancho) {
    return '<path d="M' + _n(x1) + ' ' + _n(y1) + 'L' + _n(x2) + ' ' + _n(y2) +
      '" fill="none" stroke="' + color + '" stroke-width="' + ancho +
      '" stroke-linecap="round"/>';
  }

  // MARCO — el estribo y cualquier pieza que encuadre la sección. Va con el GANCHO
  // ABIERTO en una esquina, que es lo que un marco de fierro es: un rectángulo
  // cerrado a secas se leería como una segunda línea de hormigón.
  function _marco(x0, y0, x1, y1, color) {
    var g = Math.min(3, (x1 - x0) * 0.32, (y1 - y0) * 0.32);
    return '<path d="M' + _n(x1 - g) + ' ' + _n(y0) + 'H' + _n(x0) + 'V' + _n(y1) +
      'H' + _n(x1) + 'V' + _n(y0 + g) + '" fill="none" stroke="' + color +
      '" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/>';
  }

  // Las dos cotas: el ancho abajo y el alto a la izquierda, cada una con sus líneas
  // de referencia y sus marcas de extremo. Los NÚMEROS son los del template.
  function _cotas(g, w, h, color, fuente) {
    var t = 1.5;                                     // media marca de extremo
    var yb = g.ry + g.rh, xd = g.rx + g.rw;
    var x_txt = g.canto - 2.6;                       // el número, a la izquierda de su línea
    return [
      // referencia: del hormigón hasta cada línea de cota
      _linea(g.rx, yb, g.rx, g.pie + t, color, 0.4),
      _linea(xd, yb, xd, g.pie + t, color, 0.4),
      _linea(g.rx, g.ry, g.canto - t, g.ry, color, 0.4),
      _linea(g.rx, yb, g.canto - t, yb, color, 0.4),
      // (las dos de arriba son cortas a propósito: la cota va pegada al canto)
      // la cota del ANCHO, abajo
      _linea(g.rx, g.pie, xd, g.pie, color, 0.5),
      _linea(g.rx, g.pie - t, g.rx, g.pie + t, color, 0.5),
      _linea(xd, g.pie - t, xd, g.pie + t, color, 0.5),
      '<text x="' + _n(g.rx + g.rw / 2) + '" y="' + _n(g.pie + fuente + 1.5) +
      '" font-size="' + fuente + '" fill="' + color + '" text-anchor="middle">' +
      _medida(w) + '</text>',
      // la cota del ALTO, a la izquierda
      _linea(g.canto, g.ry, g.canto, yb, color, 0.5),
      _linea(g.canto - t, g.ry, g.canto + t, g.ry, color, 0.5),
      _linea(g.canto - t, yb, g.canto + t, yb, color, 0.5),
      '<text x="' + _n(x_txt) + '" y="' + _n(g.ry + g.rh / 2) + '" font-size="' + fuente +
      '" fill="' + color + '" text-anchor="middle" transform="rotate(-90 ' + _n(x_txt) +
      ' ' + _n(g.ry + g.rh / 2) + ')">' + _medida(h) + '</text>'
    ].join('');
  }

  // UN grupo de barras → su trazo. Devuelve '' para un token que no se entiende: no
  // dibujar nada es mejor que dibujar algo que la receta no dijo.
  function _grupo(tk, g, color) {
    var x0 = g.rx + g.padX, x1 = g.rx + g.rw - g.padX;
    var y0 = g.ry + g.padY, y1 = g.ry + g.rh - g.padY;
    if (tk.forma === 'm') return _marco(x0, y0, x1, y1, color);

    // DÓNDE se pone cada barra del grupo: dentro del recubrimiento y arrimadas un pelo
    // hacia el núcleo (ver ARRIMO). Vale para las tres formas, y de ahí sale lo que
    // hace legible el dibujo: la traba, que se dibuja ENTERA de recubrimiento a
    // recubrimiento, asoma sus puntas por fuera de las dos cortinas que cose — que es
    // exactamente lo que hace (está medido en tests/test_muro_orientaciones.js: «sus
    // dos puntas pasan POR FUERA de los ejes de las dos cortinas: las cose»). Sin ese
    // cruce, dos cortinas más dos trabas cierran un rectángulo perfecto y la miniatura
    // se lee como un estribo, que es otra cosa.
    var ax0 = Math.min(x0 + ARRIMO, (x0 + x1) / 2), ax1 = Math.max(x1 - ARRIMO, (x0 + x1) / 2);
    var ay0 = Math.min(y0 + ARRIMO, (y0 + y1) / 2), ay1 = Math.max(y1 - ARRIMO, (y0 + y1) / 2);

    var xs = _reparto(_caben(tk.cols, ax1 - ax0), ax0, ax1);
    var ys;
    if (tk.region === 's') ys = _pila(_caben(tk.filas, ay1 - ay0), ay0, ay1);
    else if (tk.region === 'i') ys = _pila(_caben(tk.filas, ay1 - ay0), ay1, ay0);
    else ys = _reparto(_caben(tk.filas, ay1 - ay0), ay0, ay1);

    var out = [], i, j;
    // Una pieza que CRUZA se ve ENTERA: su largo lo pone el hormigón (de recubrimiento
    // a recubrimiento), no el reparto del otro eje — una traba tiene una por altura, no
    // una por columna.
    if (tk.forma === 'v') {
      for (i = 0; i < xs.length; i++) out.push(_linea(xs[i], y0, xs[i], y1, color, 0.9));
      return out.join('');
    }
    if (tk.forma === 'h') {
      for (i = 0; i < ys.length; i++) out.push(_linea(x0, ys[i], x1, ys[i], color, 0.9));
      return out.join('');
    }
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j < ys.length; j++) {
        out.push('<circle cx="' + _n(xs[i]) + '" cy="' + _n(ys[j]) + '" r="' +
          RADIO_PUNTO + '" fill="' + color + '"/>');
      }
    }
    return out.join('');
  }

  // Geometría del dibujo a partir del resumen y del tamaño pedido.
  function _encuadre(sec, W, H) {
    var caja = {
      x: W * M_IZQ, y: H * M_ARR,
      w: W * (1 - M_IZQ - M_DER), h: H * (1 - M_ARR - M_ABA)
    };
    var ar = _clamp(sec.w / sec.h, AR_MIN, AR_MAX);
    var rw, rh;
    if (ar * caja.h <= caja.w) { rh = caja.h; rw = ar * rh; }
    else { rw = caja.w; rh = rw / ar; }
    // Apoyada abajo: así la cota del ancho queda SIEMPRE a la misma altura y una
    // lista de miniaturas se lee como una fila de secciones, no como un mosaico.
    var g = {
      rx: caja.x + (caja.w - rw) / 2, ry: caja.y + caja.h - rh, rw: rw, rh: rh,
      pie: caja.y + caja.h + H * Y_COTA_H,
      canto: 0
    };
    g.canto = g.rx - W * X_COTA_V;
    // RECUBRIMIENTO REAL escalado a cada eje. Con la proporción acotada el escalado ya
    // no es fiel —por eso hay piso y techo—, pero el dato sigue mandando: un template
    // con 5 cm de recubrimiento separa más el fierro del borde que uno con 2.
    // El PISO es proporcional al dibujo y no un número fijo: en un muro de 250 cm de
    // alto el recubrimiento real vale 0,6 px y el fierro salía clavado en el borde del
    // hormigón. Cuando el recubrimiento real da MÁS que el piso, manda el dato.
    var r = Math.max(0, Number(sec.r) || 0);
    g.padX = _clamp(rw * (r / sec.w), Math.min(3, rw * 0.12), rw * 0.3);
    g.padY = _clamp(rh * (r / sec.h), Math.min(3, rh * 0.12), rh * 0.3);
    return g;
  }

  function _abre(W, H) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  }

  // EL HUECO: una receta que no se puede dibujar NO recibe una silueta inventada.
  function _hueco(W, H) {
    return _abre(W, H) +
      '<rect x="2" y="2" width="' + (W - 4) + '" height="' + (H - 4) +
      '" rx="3" fill="none" stroke="' + HUECO + '" stroke-width="1" stroke-dasharray="3 2.5"/>' +
      '<text x="' + (W / 2) + '" y="' + (H / 2 + 3) + '" font-size="9" fill="' + HUECO +
      '" text-anchor="middle">sin sección</text></svg>';
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  // svg(seccion, opts) → el <svg> como texto.
  //   seccion: el resumen del backend, o null/undefined → el hueco.
  //   opts: { width, height, color, hormigon, borde, cota } — todos opcionales; los
  //         colores entran por parámetro (ver la cabecera).
  function svg(sec, opts) {
    opts = opts || {};
    var W = Number(opts.width) || 110, H = Number(opts.height) || 80;
    var w = sec ? _pos(sec.w) : null, h = sec ? _pos(sec.h) : null;
    if (w === null || h === null) return _hueco(W, H);

    var tinta = opts.color || TINTA;
    var fuente = Math.max(6, Math.round(H * 0.105));
    var g = _encuadre({ w: w, h: h, r: sec.r }, W, H);
    var partes = [_abre(W, H),
      '<rect x="' + _n(g.rx) + '" y="' + _n(g.ry) + '" width="' + _n(g.rw) +
      '" height="' + _n(g.rh) + '" fill="' + (opts.hormigon || HORMIGON) +
      '" stroke="' + (opts.borde || HORMIGON_BORDE) + '" stroke-width=".7"/>'];
    // Los grupos, en el orden en que vienen: el resumen ya los trae deduplicados y
    // acotados, acá no se decide nada sobre ellos.
    var lista = (sec.p && sec.p.length) ? sec.p : [];
    for (var i = 0; i < lista.length; i++) {
      var tk = _tok(lista[i]);
      if (tk) partes.push(_grupo(tk, g, tinta));
    }
    partes.push(_cotas(g, w, h, opts.cota || COTA, fuente), '</svg>');
    return partes.join('');
  }

  // EL TOOLTIP VIVE ACÁ y no en el llamador: la frase que separa «cota real» de
  // «dibujo esquemático» es parte del dibujo, y dos copias de esa frase serían dos
  // promesas distintas sobre lo mismo.
  function titulo(sec) {
    var w = sec ? _pos(sec.w) : null, h = sec ? _pos(sec.h) : null;
    if (w === null || h === null) {
      return 'Esta receta no trae las medidas del hormigón, así que no hay sección ' +
        'que dibujar. Ábrela para ver qué le falta.';
    }
    var cab = 'Esquema de la sección · ' + _medida(w) + ' × ' + _medida(h) +
      ' cm. Las medidas son las del template; ';
    if (!sec.p || !sec.p.length) {
      return cab + 'la receta no declara barras que se puedan situar en el corte.';
    }
    return cab + 'el fierro va esquemático (la miniatura no corre el motor, así que ' +
      'la posición exacta se ve al abrir el template).';
  }

  var API = {
    svg: svg, titulo: titulo,
    // Expuestos para los tests y para poder probar otros tonos sin cazar el hex.
    TINTA: TINTA, HORMIGON: HORMIGON, HORMIGON_BORDE: HORMIGON_BORDE, COTA: COTA,
    _tok: _tok, _reparto: _reparto, _encuadre: _encuadre
  };
  global.ModeladorSeccionMini = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
