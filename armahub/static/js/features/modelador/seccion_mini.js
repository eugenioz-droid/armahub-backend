// =============================================================================
// Modelador — MINIATURA DE SECCIÓN (columna «Sección» del Gestor de templates)
//
// QUÉ DIBUJA: el corte del elemento, sus COTAS y un ESQUEMA del fierro, a partir de
// dos cosas:
//   1) el resumen compacto que manda GET /templates (modelador._resumen_seccion):
//        { x:400, y:250, z:20, rl:2.5, rb:3, p:['1.5.2:x','5.1.2:y','3.2.1:z'] }
//      x/y/z = las TRES medidas del hormigón en los ejes del motor (largo · alto ·
//      ancho); rl/rb = recubrimiento de caras y de bordes; cada token dice cuántas
//      barras del grupo hay SOBRE CADA EJE, por dónde corre la pieza, si su contorno
//      cierra y contra qué cara se apoya.
//   2) el PLANO del corte, que lo pasa quien llama.
//
// EL PLANO NO SE ELIGE ACÁ, Y ÉSE ES EL PUNTO (26-ago)
// -----------------------------------------------------------------------------
// La primera versión dibujaba siempre el corte transversal (ancho × alto). Para una
// viga está bien; para un MURO ése es el CANTO —la vista menos informativa de las
// tres— y por eso los muros se seguían pareciendo entre sí. Cuál es «la sección» de
// cada elemento YA está decidido y en un solo sitio: `PLANOS_POR_ELEMENTO` en
// template_editor.js, la misma tabla que rotula los cuadrantes del editor. Un muro se
// trabaja en el CORTE HORIZONTAL (largo × espesor, el que el editor rotula
// «SECCIÓN · YX»), que es donde viven sus dos cortinas y sus trabas.
// Así que este dibujante recibe el plano `{u, v, recub}` y PROYECTA: `u` es el eje
// horizontal del dibujo, `v` el vertical y el tercero es la profundidad. De ahí sale
// todo lo demás — cuántas barras se ven en cada dirección y si una pieza se ve como
// punto (va por la profundidad: el corte la parte), como línea (va por un eje del
// plano) o como marco. Sin plano NO se dibuja: inventar uno acá sería tener dos
// verdades sobre la misma pregunta, y una lista de tipos escrita a mano se quedaría
// atrás el día que exista un elemento nuevo.
//
// LA MINIATURA NO PUEDE MENTIR (y por eso hay dos verdades distintas acá)
// -----------------------------------------------------------------------------
//   · LAS COTAS SON DATO REAL: son las dos medidas del hormigón que forman ESE plano.
//     Un muro cota 400 × 20 porque el template dice largo 400 y espesor 20.
//   · EL DIBUJO ES UN ESQUEMA, y se dice con esa palabra en la columna y en el
//     tooltip (ver `titulo`), no con un asterisco al pie que nadie lee. Dos motivos,
//     ninguno disimulable:
//       - las POSICIONES de las barras las calcula el motor (ModeladorGenerar), que
//         es JS y no corre en el backend: el resumen dice cuántas hay por eje y
//         contra qué cara, no dónde queda cada barra al milímetro;
//       - la PROPORCIÓN va acotada (ver AR_MIN/AR_MAX): un muro de 400 × 20 a escala
//         fiel es una tira de 4 px donde no se ve un solo fierro, y en 110 px la
//         fidelidad al milímetro no aporta nada.
//   · SIN RESUMEN (o sin plano) NO SE INVENTA UNA SILUETA: se devuelve un hueco que
//     lo dice (ver `_hueco`). Una receta que no se puede dibujar tiene que verse como
//     lo que es.
//
// POR QUÉ NO SE REUSA disenadorMotor: `svgDesdePuntos` dibuja una FIGURA —la forma
// doblada de UNA barra, desde su polilínea—. Acá se pinta un CORTE del hormigón con
// los grupos de barras situados contra sus caras. Meterlas en el mismo motor
// obligaría a ramificarlo por «¿esto es una barra o un corte?».
//
// EL COLOR ENTRA POR PARÁMETRO (mismo trato que disenadorMotor.TINTA/TINTA_3D): el
// dibujante no sabe —ni tiene por qué— de dónde salió el template que le pasan.
//
// PINTAR NO ESCRIBE: `svg()` sólo LEE el resumen y el plano.
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

  var EJES = ['x', 'y', 'z'];

  // Caja de trabajo dentro del viewBox: se reservan la izquierda para la cota vertical
  // y el pie para la horizontal. Van como PROPORCIÓN del tamaño pedido, así que la
  // miniatura se puede pedir más grande sin recalcular nada a mano.
  var M_IZQ = 0.165, M_DER = 0.045, M_ARR = 0.062, M_ABA = 0.225;
  // La cota vertical va PEGADA al canto izquierdo del hormigón (y no en una columna
  // fija): con una fija, una sección angosta —que se dibuja al medio— dejaba 40 px de
  // línea de referencia vacía cruzando la miniatura entera.
  var X_COTA_V = 0.055;
  var Y_COTA_H = 0.075;

  // PROPORCIÓN ACOTADA — ver «LA MINIATURA NO PUEDE MENTIR». El techo se subió a 5 al
  // pasar los muros a su corte horizontal: 400 × 20 es 20:1 y con el 3.2 de antes el
  // muro salía casi cuadrado, que se leía como una viga tumbada. Con 5:1 se lee como
  // una tajada de muro y las dos cortinas todavía caben con holgura.
  var AR_MIN = 0.30, AR_MAX = 5;

  // Separación mínima entre dos barras dibujadas. Un grupo con más barras de las que
  // caben se pinta con las que caben: a esta escala la diferencia entre 14 puntos y 22
  // no es información, es un borrón (y el tooltip ya dice que es un esquema).
  var PASO_MIN = 3;
  var PASO_CAPA = 3.4;             // cuánto se separan las capas apiladas contra su cara
  var RADIO_PUNTO = 1.45;
  // Las barras CORTADAS se arriman por dentro del recubrimiento en vez de quedar
  // clavadas en él: en una sección de verdad el longitudinal va por dentro del marco
  // que lo abraza. De ahí sale, además, lo que hace legible el dibujo de un muro: la
  // traba, que se dibuja ENTERA de recubrimiento a recubrimiento, asoma sus puntas por
  // fuera de las dos cortinas que cose — que es exactamente lo que hace (medido en
  // tests/test_muro_orientaciones.js: «sus dos puntas pasan POR FUERA de los ejes de
  // las dos cortinas: las cose»). Sin ese cruce, dos cortinas más dos trabas cierran un
  // rectángulo perfecto y la miniatura se lee como un estribo, que es otra cosa.
  var ARRIMO = RADIO_PUNTO;

  // Un token del resumen: barras por eje + rumbo + contorno cerrado + cara de apoyo.
  // Lo que no calce con esto NO se dibuja (no se adivina): el resumen es un contrato.
  var RE_TOKEN = /^(\d+)\.(\d+)\.(\d+):([xyz])(c?)(?:@([xyz])([+-]?))?$/;

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
    return {
      n: { x: parseInt(m[1], 10), y: parseInt(m[2], 10), z: parseInt(m[3], 10) },
      r: m[4], cerrada: m[5] === 'c',
      ancla: m[6] ? { eje: m[6], signo: (m[7] === '-' ? -1 : (m[7] === '+' ? 1 : 0)) } : null
    };
  }

  // El eje que NO está en el plano: la profundidad que el corte colapsa.
  function _fondo(u, v) {
    for (var i = 0; i < 3; i++) if (EJES[i] !== u && EJES[i] !== v) return EJES[i];
    return 'x';
  }

  // TOKEN + PLANO → cómo se ve ese grupo en ESTE corte. Es todo el trabajo de
  // proyección, y no tiene una sola rama por tipo de elemento: pregunta por dónde
  // corre la pieza y lo compara con los ejes del plano.
  function _proyectar(tk, u, v) {
    var d = _fondo(u, v), forma;
    if (tk.cerrada) {
      // Un contorno cerrado vive en el plano ⊥ a su rumbo. Si ése ES el plano de la
      // vista (rumbo = profundidad) se ve el MARCO entero; si no, se ve DE CANTO, o
      // sea un segmento por el eje del plano que su marco sí contiene.
      forma = (tk.r === d) ? 'm' : ((tk.r === u) ? 'v' : 'h');
    } else {
      // Una barra recta: si corre por la profundidad el corte la parte (punto); si
      // corre por un eje del plano se ve entera (línea por ese eje).
      forma = (tk.r === d) ? 'p' : ((tk.r === u) ? 'h' : 'v');
    }
    return {
      cols: tk.n[u], filas: tk.n[v], forma: forma,
      // El apoyo sólo cuenta si su cara está EN el plano: una pila que se apila hacia
      // la profundidad se ve de frente, o sea repartida.
      aU: (tk.ancla && tk.ancla.eje === u) ? tk.ancla.signo : 0,
      aV: (tk.ancla && tk.ancla.eje === v) ? tk.ancla.signo : 0
    };
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

  // Capas apiladas DESDE una cara hacia el núcleo.
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

  // Posiciones en UN eje: apiladas desde su cara si el grupo se apoya en ese eje,
  // repartidas si no.
  function _posiciones(n, a, b, apoyo, vertical) {
    n = _caben(n, Math.abs(b - a));
    if (!apoyo) return _reparto(n, a, b);
    // apoyo +1 = contra el extremo POSITIVO del eje del hormigón. En el eje vertical
    // del dibujo el positivo queda ARRIBA (la y del SVG crece hacia abajo).
    var haciaMax = vertical ? (apoyo < 0) : (apoyo > 0);
    return haciaMax ? _pila(n, b, a) : _pila(n, a, b);
  }

  function _linea(x1, y1, x2, y2, color, ancho) {
    return '<path d="M' + _n(x1) + ' ' + _n(y1) + 'L' + _n(x2) + ' ' + _n(y2) +
      '" fill="none" stroke="' + color + '" stroke-width="' + ancho +
      '" stroke-linecap="round"/>';
  }

  // MARCO — el estribo y cualquier pieza que encuadre este corte. Va con el GANCHO
  // ABIERTO en una esquina, que es lo que un marco de fierro es: un rectángulo cerrado
  // a secas se leería como una segunda línea de hormigón.
  function _marco(x0, y0, x1, y1, color) {
    var g = Math.min(3, (x1 - x0) * 0.32, (y1 - y0) * 0.32);
    return '<path d="M' + _n(x1 - g) + ' ' + _n(y0) + 'H' + _n(x0) + 'V' + _n(y1) +
      'H' + _n(x1) + 'V' + _n(y0 + g) + '" fill="none" stroke="' + color +
      '" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/>';
  }

  // Las dos cotas: la del eje horizontal abajo y la del vertical al canto, cada una con
  // sus líneas de referencia y sus marcas de extremo. Los NÚMEROS son los del template.
  function _cotas(g, w, h, color, fuente) {
    var t = 1.5;                                     // media marca de extremo
    var yb = g.ry + g.rh, xd = g.rx + g.rw;
    var x_txt = g.canto - 2.6;                       // el número, a la izquierda de su línea
    return [
      _linea(g.rx, yb, g.rx, g.pie + t, color, 0.4),
      _linea(xd, yb, xd, g.pie + t, color, 0.4),
      _linea(g.rx, g.ry, g.canto - t, g.ry, color, 0.4),
      _linea(g.rx, yb, g.canto - t, yb, color, 0.4),
      _linea(g.rx, g.pie, xd, g.pie, color, 0.5),
      _linea(g.rx, g.pie - t, g.rx, g.pie + t, color, 0.5),
      _linea(xd, g.pie - t, xd, g.pie + t, color, 0.5),
      '<text x="' + _n(g.rx + g.rw / 2) + '" y="' + _n(g.pie + fuente + 1.5) +
      '" font-size="' + fuente + '" fill="' + color + '" text-anchor="middle">' +
      _medida(w) + '</text>',
      _linea(g.canto, g.ry, g.canto, yb, color, 0.5),
      _linea(g.canto - t, g.ry, g.canto + t, g.ry, color, 0.5),
      _linea(g.canto - t, yb, g.canto + t, yb, color, 0.5),
      '<text x="' + _n(x_txt) + '" y="' + _n(g.ry + g.rh / 2) + '" font-size="' + fuente +
      '" fill="' + color + '" text-anchor="middle" transform="rotate(-90 ' + _n(x_txt) +
      ' ' + _n(g.ry + g.rh / 2) + ')">' + _medida(h) + '</text>'
    ].join('');
  }

  // UN grupo de barras ya proyectado → su trazo.
  function _grupo(pr, g, color) {
    var x0 = g.rx + g.padX, x1 = g.rx + g.rw - g.padX;
    var y0 = g.ry + g.padY, y1 = g.ry + g.rh - g.padY;
    if (pr.forma === 'm') return _marco(x0, y0, x1, y1, color);

    var ax0 = Math.min(x0 + ARRIMO, (x0 + x1) / 2), ax1 = Math.max(x1 - ARRIMO, (x0 + x1) / 2);
    var ay0 = Math.min(y0 + ARRIMO, (y0 + y1) / 2), ay1 = Math.max(y1 - ARRIMO, (y0 + y1) / 2);
    var xs = _posiciones(pr.cols, ax0, ax1, pr.aU, false);
    var ys = _posiciones(pr.filas, ay0, ay1, pr.aV, true);

    var out = [], i, j;
    // Una pieza que se ve ENTERA ocupa todo el hormigón útil por su eje: su largo lo
    // pone el corte, no el reparto del otro eje (una traba tiene una por altura, no
    // una por columna).
    if (pr.forma === 'v') {
      for (i = 0; i < xs.length; i++) out.push(_linea(xs[i], y0, xs[i], y1, color, 0.9));
      return out.join('');
    }
    if (pr.forma === 'h') {
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

  // Geometría del dibujo: rectángulo del hormigón, líneas de cota y recubrimientos.
  function _encuadre(w, h, rU, rV, W, H) {
    var caja = {
      x: W * M_IZQ, y: H * M_ARR,
      w: W * (1 - M_IZQ - M_DER), h: H * (1 - M_ARR - M_ABA)
    };
    var ar = _clamp(w / h, AR_MIN, AR_MAX);
    var rw, rh;
    if (ar * caja.h <= caja.w) { rh = caja.h; rw = ar * rh; }
    else { rw = caja.w; rh = rw / ar; }
    // Apoyada abajo: así la cota horizontal queda SIEMPRE a la misma altura y una lista
    // de miniaturas se lee como una fila de secciones, no como un mosaico.
    var g = {
      rx: caja.x + (caja.w - rw) / 2, ry: caja.y + caja.h - rh, rw: rw, rh: rh,
      pie: caja.y + caja.h + H * Y_COTA_H, canto: 0
    };
    g.canto = g.rx - W * X_COTA_V;
    // RECUBRIMIENTO REAL escalado a cada eje. Con la proporción acotada el escalado ya
    // no es fiel —por eso hay piso y techo—, pero el dato sigue mandando: un template
    // con 5 cm de recubrimiento separa más el fierro del borde que uno con 2. El PISO
    // es proporcional al dibujo y no un número fijo: en un muro de 400 cm de largo el
    // recubrimiento real vale medio píxel y el fierro salía clavado en el borde.
    g.padX = _clamp(rw * (Math.max(0, rU) / w), Math.min(3, rw * 0.12), rw * 0.3);
    g.padY = _clamp(rh * (Math.max(0, rV) / h), Math.min(3, rh * 0.12), rh * 0.3);
    return g;
  }

  function _abre(W, H) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  }

  // EL HUECO: lo que no se puede dibujar NO recibe una silueta inventada.
  function _hueco(W, H) {
    return _abre(W, H) +
      '<rect x="2" y="2" width="' + (W - 4) + '" height="' + (H - 4) +
      '" rx="3" fill="none" stroke="' + HUECO + '" stroke-width="1" stroke-dasharray="3 2.5"/>' +
      '<text x="' + (W / 2) + '" y="' + (H / 2 + 3) + '" font-size="9" fill="' + HUECO +
      '" text-anchor="middle">sin sección</text></svg>';
  }

  // Recubrimiento que recorta un eje del plano, con el MISMO criterio que el editor
  // (PLANOS_POR_ELEMENTO.recub): 'lat' = el de las caras, 'supinf' = el de los bordes.
  function _recub(sec, cual) {
    var n = Number(cual === 'supinf' ? sec.rb : sec.rl);
    if (!isFinite(n) || n < 0) n = Number(sec.rl);
    return (isFinite(n) && n >= 0) ? n : 0;
  }

  // Las dos medidas del plano, o null si el resumen o el plano no dan para dibujarlo.
  function _medidas(sec, plano) {
    if (!sec || !plano) return null;
    var u = plano.u, v = plano.v;
    if (EJES.indexOf(u) < 0 || EJES.indexOf(v) < 0 || u === v) return null;
    var w = _pos(sec[u]), h = _pos(sec[v]);
    if (w === null || h === null) return null;
    var rec = plano.recub || {};
    return { u: u, v: v, w: w, h: h, rU: _recub(sec, rec.W), rV: _recub(sec, rec.H) };
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  // svg(seccion, plano, opts) → el <svg> como texto.
  //   seccion: el resumen del backend (o null/undefined → el hueco).
  //   plano:   { u, v, recub:{W,H} } — el mismo objeto que PLANOS_POR_ELEMENTO define
  //            para ese elemento. SIN PLANO NO SE DIBUJA (ver la cabecera).
  //   opts:    { width, height, color, hormigon, borde, cota } — todos opcionales.
  function svg(sec, plano, opts) {
    opts = opts || {};
    var W = Number(opts.width) || 110, H = Number(opts.height) || 80;
    var m = _medidas(sec, plano);
    if (!m) return _hueco(W, H);

    var tinta = opts.color || TINTA;
    var fuente = Math.max(6, Math.round(H * 0.105));
    var g = _encuadre(m.w, m.h, m.rU, m.rV, W, H);
    var partes = [_abre(W, H),
      '<rect x="' + _n(g.rx) + '" y="' + _n(g.ry) + '" width="' + _n(g.rw) +
      '" height="' + _n(g.rh) + '" fill="' + (opts.hormigon || HORMIGON) +
      '" stroke="' + (opts.borde || HORMIGON_BORDE) + '" stroke-width=".7"/>'];
    // Los grupos, en el orden en que vienen: el resumen ya los trae deduplicados y
    // acotados, acá no se decide nada sobre ellos.
    var lista = (sec.p && sec.p.length) ? sec.p : [];
    for (var i = 0; i < lista.length; i++) {
      var tk = _tok(lista[i]);
      if (tk) partes.push(_grupo(_proyectar(tk, m.u, m.v), g, tinta));
    }
    partes.push(_cotas(g, m.w, m.h, opts.cota || COTA, fuente), '</svg>');
    return partes.join('');
  }

  // EL TOOLTIP VIVE ACÁ y no en el llamador: la frase que separa «cota real» de
  // «dibujo esquemático» es parte del dibujo, y dos copias de esa frase serían dos
  // promesas distintas sobre lo mismo.
  //   rotulo: las letras de eje con que el editor rotula ese mismo cuadrante (p.ej.
  //           'YX'). Opcional — si viaja, la miniatura y el editor dicen el mismo
  //           nombre del plano en vez de dos.
  function titulo(sec, plano, rotulo) {
    var m = _medidas(sec, plano);
    if (!m) {
      return 'Esta receta no trae las medidas del hormigón, así que no hay sección ' +
        'que dibujar. Ábrela para ver qué le falta.';
    }
    var cab = 'Esquema de la sección' + (rotulo ? ' · ' + rotulo : '') + ' · ' +
      _medida(m.w) + ' × ' + _medida(m.h) + ' cm. Las medidas son las del template; ';
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
    _tok: _tok, _proyectar: _proyectar, _reparto: _reparto, _encuadre: _encuadre
  };
  global.ModeladorSeccionMini = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
