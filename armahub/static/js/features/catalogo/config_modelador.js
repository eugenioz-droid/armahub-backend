/* =============================================================================
 * CONFIGURACIÓN DEL MODELADOR — las 4 tablas de la tarjeta «Configuración»
 * (sub-tab Catálogo › Template Editor · tabs/catalogo.html)
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE: los valores con los que NACE cada barra (figura, φ, @ sep, modo
 * de colocación, recubrimiento, largo del gancho) están repartidos entre
 * semilla_viga.js, reglas.js, catalogo_figuras.js y template_editor.js. Quien no
 * lea el código no tiene forma de saber con qué se está trabajando, y hay valores
 * que YA divergieron: el gancho del modelador es 6φ (figura_puntos.js) y el de la
 * configuración de obra 10φ, así que la misma barra sale con patas distintas
 * según dónde se cree. Esta pantalla los pone todos a la vista.
 *
 * ⚠ ESTA ITERACIÓN SÓLO MUESTRA. No guarda en la base y el editor NO lee de aquí:
 * por eso los campos van DESHABILITADOS y cada modal lo dice arriba. Poner inputs
 * que se dejan escribir y no persisten sería peor que no ponerlos: el usuario
 * creería que configuró algo. El cableado (tabla en la base + que el editor lea
 * de ella) es la iteración siguiente.
 *
 * DE DÓNDE SALEN LOS NÚMEROS (y qué NO tiene fuente todavía):
 *   · figuras sugeridas → catalogo_figuras.js  FIGURAS_POR_TIPOLOGIA
 *   · modo colocación   → reglas.js            TIPOLOGIA_MODO_DEFAULT
 *   · @ sep             → template_editor.js   SEP_POR_TIPOLOGIA (40 trabas / 20 resto)
 *   · recubrimientos    → template_editor.js   TPL_DIMS_POR_ELEMENTO
 *   · figura y φ        → semilla_viga.js, y SÓLO para viga. Los de muro son la
 *                         propuesta de esta pantalla: hoy no los usa nadie. Va
 *                         dicho al pie de cada tabla, no escondido.
 * Donde la maqueta aprobada (static/demo/config_modelador.html) decía una cosa y
 * el código hace otra, manda el CÓDIGO y queda anotado en el comentario de la
 * fila: esta pantalla sirve para ver la realidad, no para maquillarla.
 * ========================================================================== */
(function (global) {
  'use strict';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ===========================================================================
  // DATOS — espejo local, TODAVÍA SIN CABLEAR (ver cabecera)
  // ===========================================================================

  // Colores de elemento: los mismos de TPL_ELEM_COLORES (template_editor.js), para
  // que un MURO se reconozca igual en la lista de templates y aquí.
  var CFG_ELEM_COLORES = {
    MURO: '#795548', LOSA: '#607d8b', VIGA: '#558B2F',
    COLUMNA: '#1565c0', FUNDACION: '#5d4037', GEN: '#616161'
  };

  // --- 1 · FIGURAS POR TIPOLOGÍA -------------------------------------------
  // La clave es ELEMENTO-TIPOLOGÍA, no la tipología sola: una ES de viga y una EC
  // de muro son filas distintas (así está la tabla que ya existe en la base).
  var CFG_TIPOLOGIAS = [
    {
      elem: 'VIGA',
      sub: 'La <b>figura por defecto</b> es la que se coloca de un clic. Las <b>sugeridas</b> son las ' +
           'que aparecen al abrir el buscador; escribiendo se llega a cualquiera del catálogo.',
      filas: [
        { cod: 'CBS', nombre: 'Cabezal Superior', def: '103B', diam: 16, sep: 20, modo: 'Puntual',
          figs: ['101A', '102A', '102B', '102C', '103A', '103B', '103C', '103D'] },
        // La semilla de viga crea el CBI con 101A; la maqueta lo mostró con 103B
        // (cabezal con dos patas) y es lo que se quiere de partida. Queda 103B.
        { cod: 'CBI', nombre: 'Cabezal Inferior', def: '103B', diam: 18, sep: 20, modo: 'Puntual',
          figs: ['101A', '102A', '102B', '102C', '103A', '103B', '103C', '103D'] },
        { cod: 'ES', nombre: 'Estribo', def: '104D', diam: 8, sep: 20, modo: 'Distribución',
          figs: ['103H', '103E', '104D', '104O', '104P'] },
        { cod: 'TRV', nombre: 'Traba Viga', def: '101A', diam: 8, sep: 40, modo: 'Distribución',
          figs: ['101A', '102A'] },
        { cod: 'LT', nombre: 'Lateral', def: '101A', diam: 12, sep: 20, modo: 'Puntual',
          figs: ['101A', '102A', '103A'] }
      ],
      pie: 'CBS2 / CBSn / CBI2 / CBIn (las capas 2 y n) siguen la misma fila, pero hoy no tienen ' +
           'ningún valor de partida escrito en el código: por eso no aparecen inventadas aquí.'
    },
    {
      elem: 'MURO',
      sub: 'Mismas columnas. Ojo que las mallas de muro se colocan como distribución («MH φ8 @20»), ' +
           'no como arreglo.',
      filas: [
        { cod: 'MH', nombre: 'Malla Horizontal', def: '101A', diam: 8, sep: 20, modo: 'Distribución',
          figs: ['101A', '102A', '102B', '102C', '103A', '103G'] },
        { cod: 'MV', nombre: 'Malla Vertical', def: '101A', diam: 8, sep: 20, modo: 'Distribución',
          figs: ['101A', '102A', '102B', '102C', '103A', '103G'] },
        // La maqueta ponía «Arreglo» y @15 para EC; el código hace lineal
        // (= Distribución, reglas.js) y @20 (EC no está en SEP_POR_TIPOLOGIA).
        // Se muestra lo que el código HACE hoy, que es el punto de esta pantalla.
        { cod: 'EC', nombre: 'Estribo Confinamiento', def: '104D', diam: 8, sep: 20, modo: 'Distribución',
          figs: ['103H', '103E', '104D', '104O', '104P'] },
        // Igual que EC: la maqueta decía «Arreglo», reglas.js dice TR: 'lineal'.
        { cod: 'TR', nombre: 'Traba Muro', def: '101A', diam: 8, sep: 40, modo: 'Distribución',
          figs: ['101A', '102A', '103A', '104A'] },
        { cod: 'TC', nombre: 'Traba Confinamiento', def: '101A', diam: 8, sep: 40, modo: 'Distribución',
          figs: ['101A', '102A', '102B', '102C'] },
        { cod: 'CB', nombre: 'Cabezal', def: '101A', diam: 16, sep: 20, modo: 'Puntual',
          figs: ['101A', '102A', '102B', '102C', '103A', '103B'] }
      ],
      pie: 'Losa, Columna, Fundación y Genérico tendrían su propia tarjeta, con las mismas columnas.'
    }
  ];

  // --- 2 · REGLAS DE LARGOS -------------------------------------------------
  var CFG_LARGOS_MODOS = [
    { t: 'Fabricación', on: true,
      d: 'Lo que hace el taller: pata = 10 × φ, parejo para todos los diámetros.' },
    { t: 'NCh 211', on: false,
      d: 'Según norma, sobre todo para el gancho sísmico. Los valores cambian por rango de diámetro.' },
    { t: 'Custom', on: false,
      d: 'Tú defines la tabla. Se usa cuando la especificación del proyecto manda otra cosa.' }
  ];
  // Los tres rangos traen los MISMOS números porque el modo mostrado es
  // «Fabricación» (pata pareja 10φ). En NCh 211 cambian por rango: por eso la
  // tabla está partida así y no en una sola fila.
  var CFG_LARGOS_FILAS = [
    { rango: 'φ 8 – 16', pata: '10', min: '7.5', ang: '135°', com: 'Estribos y trabas' },
    { rango: 'φ 18 – 25', pata: '10', min: '7.5', ang: '135°', com: 'Cabezales' },
    { rango: 'φ 28 – 36', pata: '10', min: '7.5', ang: '135°', com: 'Barras gruesas' }
  ];
  var CFG_REDONDEO = [
    { lbl: 'Redondear las medidas a', ops: ['Centímetro entero', 'Medio centímetro', 'No redondear'],
      com: 'Se aplica lado por lado, y el largo total es la suma de los lados ya redondeados.' },
    { lbl: 'Dónde se aplica', ops: ['Solo al cargar al despiece', 'También en la plantilla'],
      com: 'La plantilla es una receta: si se redondea ahí, el número se vuelve a calcular después contra otro hormigón.' }
  ];

  // --- 3 · RECUBRIMIENTOS ---------------------------------------------------
  // Valores REALES de TPL_DIMS_POR_ELEMENTO (template_editor.js), no los de la
  // maqueta: ahí GEN aparecía con 3 y el código usa 4.
  // MURO / COLUMNA / FUNDACIÓN / GEN tienen HOY un solo recubrimiento (el mismo
  // campo escribe sup, inf y lat): por eso repiten valor, y va dicho al pie.
  // LOSA no tiene recubrimiento lateral: '—' es el dato, no un hueco por rellenar.
  var CFG_RECUB = [
    { elem: 'VIGA', sup: '4', inf: '4', lat: '3', com: 'Los tres son campos independientes' },
    { elem: 'MURO', sup: '2.5', inf: '2.5', lat: '2.5', com: 'Un solo campo escribe caras y bordes' },
    { elem: 'COLUMNA', sup: '4', inf: '4', lat: '4', com: 'Un solo campo' },
    { elem: 'LOSA', sup: '2.5', inf: '2.5', lat: '—', com: 'La losa no define recubrimiento lateral' },
    { elem: 'FUNDACION', sup: '5', inf: '5', lat: '5', com: 'Un solo campo · contra terreno' },
    { elem: 'GEN', sup: '4', inf: '4', lat: '4', com: 'Un solo campo' }
  ];

  // --- 4 · POR FIGURA -------------------------------------------------------
  // La maqueta la llamaba «Por barra»; el usuario pidió «Por figura», que además
  // es lo correcto: la fila es una FAMILIA de figura, no una barra concreta.
  var CFG_POR_FIGURA = [
    { fam: 'Barra recta', cod: '101A', auto: ['A'], fijos: [], por: 'El largo lo da el elemento' },
    { fam: 'Con una pata', cod: '102x', auto: ['B'], fijos: ['A'], por: 'La pata es normativa; el cuerpo se estira' },
    { fam: 'Con dos patas', cod: '103x', auto: ['B'], fijos: ['A', 'C'], por: 'Igual, por los dos extremos' },
    { fam: 'Estribo cerrado', cod: '104x', auto: ['A', 'B', 'C', 'D'], fijos: [], por: 'El marco se ajusta al hormigón completo' },
    { fam: 'Estribo con ganchos', cod: '106x', auto: ['B', 'C', 'D', 'E'], fijos: ['A', 'F'], por: 'A y F son los ganchos declarados' }
  ];

  // ===========================================================================
  // RENDER DE LAS TABLAS
  // ===========================================================================

  function _chips(figs, def) {
    return figs.map(function (f) {
      // El chip verde marca la figura por defecto DENTRO de las sugeridas: si la
      // por defecto no estuviera en la lista, se vería de inmediato (ninguna verde).
      return '<span class="cfgmod-chip' + (f === def ? ' def' : '') + '">' + _esc(f) + '</span>';
    }).join('');
  }

  // Todos los campos van deshabilitados: esta pantalla NO guarda (ver cabecera).
  function _num(valor) {
    return '<input class="cfgmod-w70" value="' + _esc(valor) + '" disabled>';
  }
  function _sel(opciones, elegida) {
    return '<select disabled>' + opciones.map(function (o) {
      return '<option' + (o === elegida ? ' selected' : '') + '>' + _esc(o) + '</option>';
    }).join('') + '</select>';
  }

  function _htmlTipologias() {
    var MODOS = ['Puntual', 'Distribución', 'Arreglo'];
    return '<div class="cfgmod-nota">La clave real es <b>elemento + tipología</b>, no la tipología ' +
      'sola: una <b>ES</b> de viga y una <b>EC</b> de muro son filas distintas.</div>' +
      CFG_TIPOLOGIAS.map(function (t) {
        var col = CFG_ELEM_COLORES[t.elem] || '#607d8b';
        return '<div class="cfgmod-card">' +
          '<h4><span class="cfgmod-elem" style="background:' + col + ';">' + _esc(t.elem) + '</span></h4>' +
          '<p class="cfgmod-sub">' + t.sub + '</p>' +
          '<table><thead><tr>' +
            '<th style="width:210px">Tipología</th>' +
            '<th style="width:130px">Figura por defecto</th>' +
            '<th>Figuras sugeridas</th>' +
            '<th class="num" style="width:70px">φ mm</th>' +
            '<th class="num" style="width:80px">@ sep cm</th>' +
            '<th style="width:140px">Colocación</th>' +
          '</tr></thead><tbody>' +
          t.filas.map(function (f) {
            return '<tr>' +
              '<td><b>' + _esc(f.cod) + '</b> · ' + _esc(f.nombre) + '</td>' +
              '<td>' + _sel(f.figs, f.def) + '</td>' +
              '<td>' + _chips(f.figs, f.def) + '</td>' +
              '<td class="num">' + _num(f.diam) + '</td>' +
              '<td class="num">' + _num(f.sep) + '</td>' +
              '<td>' + _sel(MODOS, f.modo) + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table>' +
          '<p class="cfgmod-pie">' + _esc(t.pie) + '</p>' +
          '<p class="cfgmod-pie"><b>De dónde salen:</b> las sugeridas y la colocación son las que ' +
          'usa el modelador hoy (catálogo de figuras y reglas). El <b>@ sep</b> también (40 en trabas, ' +
          '20 en el resto). La <b>figura por defecto</b> y el <b>φ</b> sólo están escritos para la ' +
          'viga (su semilla); los de muro son la propuesta de esta pantalla y todavía no los usa nadie.</p>' +
        '</div>';
      }).join('');
  }

  function _htmlLargos() {
    return '<div class="cfgmod-nota">Hoy el modelador tiene el gancho fijo en <b>6 × φ (mínimo ' +
      '7,5 cm)</b>, mientras que la configuración por obra que ya existe trae <b>10 × φ</b> y la usa ' +
      'el creador de barras. La misma barra sale con patas distintas según dónde se cree. Esto lo ' +
      'arregla elegir un modo y que <b>todos</b> lo lean.</div>' +
      '<div class="cfgmod-card">' +
        '<h4>Modo de norma</h4>' +
        '<p class="cfgmod-sub">El modo fija los largos que dependen de la norma. Sólo «Custom» sería ' +
        'editable; los otros dos vienen definidos y sirven para saber con qué criterio se armó cada cosa.</p>' +
        '<div class="cfgmod-modos">' +
          CFG_LARGOS_MODOS.map(function (m) {
            return '<label class="' + (m.on ? 'on' : '') + '">' +
              '<input type="radio" name="cfgmod-modo"' + (m.on ? ' checked' : '') + ' disabled>' +
              '<span><span class="t">' + _esc(m.t) + '</span>' +
              '<span class="d">' + _esc(m.d) + '</span></span></label>';
          }).join('') +
        '</div>' +
        '<table><thead><tr>' +
          '<th style="width:150px">Diámetro</th>' +
          '<th class="num" style="width:150px">Pata del gancho (× φ)</th>' +
          '<th class="num" style="width:150px">Mínimo absoluto (cm)</th>' +
          '<th class="num" style="width:170px">Ángulo gancho sísmico</th>' +
          '<th>Comentario</th>' +
        '</tr></thead><tbody>' +
        CFG_LARGOS_FILAS.map(function (f) {
          return '<tr><td>' + _esc(f.rango) + '</td>' +
            '<td class="num">' + _num(f.pata) + '</td>' +
            '<td class="num">' + _num(f.min) + '</td>' +
            '<td class="num">' + _num(f.ang) + '</td>' +
            '<td class="cfgmod-pie" style="margin:0">' + _esc(f.com) + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<p class="cfgmod-pie">Los valores mostrados son los del modo <b>Fabricación</b> (pata pareja ' +
        '10 × φ). En NCh 211 cambian por rango de diámetro: por eso la tabla está partida así.</p>' +
      '</div>' +
      '<div class="cfgmod-card">' +
        '<h4>Redondeo del corte</h4>' +
        '<p class="cfgmod-sub">Las barras no se cortan con decimales.</p>' +
        '<table><tbody>' +
        CFG_REDONDEO.map(function (r) {
          return '<tr><td style="width:340px">' + _esc(r.lbl) + '</td>' +
            '<td style="width:200px">' + _sel(r.ops, r.ops[0]) + '</td>' +
            '<td class="cfgmod-pie" style="margin:0">' + _esc(r.com) + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
      '</div>';
  }

  function _htmlRecub() {
    return '<div class="cfgmod-card">' +
      '<h4>Recubrimientos por defecto</h4>' +
      '<p class="cfgmod-sub">Con qué recubrimiento nace cada tipo de elemento. Se puede cambiar en ' +
      'cada elemento; esto es sólo el valor de partida.</p>' +
      '<table><thead><tr>' +
        '<th style="width:170px">Elemento</th>' +
        '<th class="num" style="width:120px">Superior cm</th>' +
        '<th class="num" style="width:120px">Inferior cm</th>' +
        '<th class="num" style="width:120px">Lateral cm</th>' +
        '<th>Comentario</th>' +
      '</tr></thead><tbody>' +
      CFG_RECUB.map(function (r) {
        var col = CFG_ELEM_COLORES[r.elem] || '#607d8b';
        // '—' se pinta como texto, NO como input: un campo vacío haría creer que
        // el valor existe y está sin llenar, cuando el elemento no tiene ese campo.
        function celda(v) {
          return '<td class="num">' + (v === '—' ? '<span class="cfgmod-pie">—</span>' : _num(v)) + '</td>';
        }
        return '<tr>' +
          '<td><span class="cfgmod-elem" style="background:' + col + ';">' + _esc(r.elem) + '</span></td>' +
          celda(r.sup) + celda(r.inf) + celda(r.lat) +
          '<td class="cfgmod-pie" style="margin:0">' + _esc(r.com) + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
      '<p class="cfgmod-pie">Estos son los valores que el editor usa HOY (los defaults por elemento ' +
      'del Template Editor). Muro, columna, fundación y genérico tienen un solo campo de ' +
      'recubrimiento: los tres números son el mismo valor repetido, no tres campos distintos.</p>' +
    '</div>';
  }

  function _htmlPorFigura() {
    function chips(letras, verde) {
      if (!letras.length) return '<span class="cfgmod-pie">—</span>';
      return letras.map(function (l) {
        return '<span class="cfgmod-chip' + (verde ? ' def' : '') + '">' + _esc(l) + '</span>';
      }).join('');
    }
    return '<div class="cfgmod-nota">Lo único que se presetea por figura es <b>qué lado nace en ' +
      'automático y cuál en fijo</b>. Automático = el motor lo estira contra el hormigón. ' +
      'Fijo = lo escribe el usuario.</div>' +
      '<div class="cfgmod-card">' +
      '<h4>Cómo nace cada lado</h4>' +
      '<p class="cfgmod-sub">Por familia de figura.</p>' +
      '<table><thead><tr>' +
        '<th style="width:230px">Familia de figura</th>' +
        '<th style="width:260px">Lados en automático</th>' +
        '<th style="width:260px">Lados fijos</th>' +
        '<th>Por qué</th>' +
      '</tr></thead><tbody>' +
      CFG_POR_FIGURA.map(function (f) {
        return '<tr>' +
          '<td><b>' + _esc(f.fam) + '</b> · ' + _esc(f.cod) + '</td>' +
          '<td>' + chips(f.auto, true) + '</td>' +
          '<td>' + chips(f.fijos, false) + '</td>' +
          '<td class="cfgmod-pie" style="margin:0">' + _esc(f.por) + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
      '<p class="cfgmod-pie"><b>Ojo:</b> hoy, en el código, <b>todos</b> los lados nacen en ' +
      'automático, sin excepción. La columna «Lados fijos» es lo que se quiere poder configurar; ' +
      'todavía no tiene efecto en ninguna barra.</p>' +
    '</div>';
  }

  // Cada panel: título, bajada y la función que arma su tabla. La clave es la que
  // llega desde el onclick del HTML.
  var CFG_PANELES = {
    tipologias: {
      titulo: '📐 Figuras por tipología',
      sub: 'Con qué figura, φ, separación y modo de colocación nace cada tipología, por elemento.',
      html: _htmlTipologias
    },
    largos: {
      titulo: '📏 Reglas de largos',
      sub: 'El modo de norma que fija el gancho y las patas, y el redondeo del corte.',
      html: _htmlLargos
    },
    recub: {
      titulo: '🧱 Recubrimientos',
      sub: 'El recubrimiento con el que nace cada tipo de elemento.',
      html: _htmlRecub
    },
    figura: {
      titulo: '📎 Por figura',
      sub: 'Qué lado de cada familia de figura nace en automático y cuál queda fijo.',
      html: _htmlPorFigura
    }
  };

  // ===========================================================================
  // MODAL (uno solo, se recicla). Cierra con ✕, Esc y clic fuera.
  // ===========================================================================
  var _abierto = null;      // clave del panel abierto, o null
  var _focoPrevio = null;   // a quién devolverle el foco al cerrar

  var ESTILOS =
    '#cfgModBackdrop{position:fixed; inset:0; background:rgba(15,23,32,.55); z-index:9000;' +
      ' display:none; align-items:flex-start; justify-content:center; padding:28px 16px; overflow:auto;}' +
    '#cfgModBackdrop.on{display:flex;}' +
    '#cfgModBox{background:#fff; border-radius:12px; width:100%; max-width:1240px;' +
      ' box-shadow:0 18px 48px rgba(0,0,0,.28); overflow:hidden;}' +
    '#cfgModHead{display:flex; justify-content:space-between; align-items:flex-start; gap:12px;' +
      ' padding:14px 18px; border-bottom:1px solid #e3e8ef;}' +
    '#cfgModHead h3{margin:0; font-size:15px; color:#558B2F;}' +
    '#cfgModX{border:1px solid #dbe1e8; background:#fff; border-radius:8px; cursor:pointer;' +
      ' font-size:14px; line-height:1; padding:6px 11px; color:#6b7a8d;}' +
    '#cfgModX:hover{background:#f5f7fa;}' +
    '#cfgModCuerpo{padding:14px 18px 20px; background:#f5f7fa; max-height:74vh; overflow:auto;}' +
    '#cfgModAviso{margin:0; padding:9px 18px; background:#fff8e1; border-bottom:1px solid #ffe082;' +
      ' color:#6d4c00; font-size:12px;}' +
    '.cfgmod-sub{color:#6b7a8d; font-size:12px; margin:4px 0 0;}' +
    '.cfgmod-card{background:#fff; border:1px solid #e3e8ef; border-radius:10px; padding:14px 16px;' +
      ' margin-bottom:14px;}' +
    '.cfgmod-card h4{margin:0 0 3px; font-size:14px; color:#1f2a37;}' +
    '.cfgmod-card table{width:100%; border-collapse:collapse; font-size:13px; margin-top:10px;}' +
    '.cfgmod-card th,.cfgmod-card td{text-align:left; padding:7px 9px; border-bottom:1px solid #e3e8ef;' +
      ' vertical-align:middle;}' +
    '.cfgmod-card th{font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:#6b7a8d;' +
      ' font-weight:600;}' +
    '.cfgmod-card td.num,.cfgmod-card th.num{text-align:right; font-variant-numeric:tabular-nums;}' +
    '.cfgmod-card tbody tr:hover{background:#fafcff;}' +
    '.cfgmod-card input,.cfgmod-card select{font:inherit; border:1px solid #e3e8ef; border-radius:6px;' +
      ' padding:4px 6px; background:#f7f9fc; color:#6b7a8d; width:100%;}' +
    '.cfgmod-w70{width:70px !important;}' +
    '.cfgmod-chip{display:inline-block; background:#eef3fb; border:1px solid #d6e4f7; border-radius:99px;' +
      ' padding:1px 8px; font-size:11px; margin:1px 2px 1px 0; color:#2b4a72;}' +
    '.cfgmod-chip.def{background:#e8f5e9; border-color:#c8e6c9; color:#2e7d32; font-weight:600;}' +
    '.cfgmod-elem{font-weight:700; font-size:12px; color:#fff; border-radius:5px; padding:1px 7px;' +
      ' display:inline-block;}' +
    '.cfgmod-nota{background:#fff8e1; border:1px solid #ffe082; border-radius:8px; padding:9px 11px;' +
      ' color:#6d4c00; font-size:12px; margin:0 0 14px;}' +
    '.cfgmod-pie{color:#6b7a8d; font-size:11px; margin:10px 0 0;}' +
    '.cfgmod-modos{display:flex; gap:8px; margin:12px 0; flex-wrap:wrap;}' +
    '.cfgmod-modos label{display:flex; gap:7px; align-items:flex-start; border:1px solid #e3e8ef;' +
      ' border-radius:9px; padding:9px 12px; background:#fff; flex:1; min-width:230px; font-size:13px;}' +
    '.cfgmod-modos label.on{border-color:#8BC34A; box-shadow:0 0 0 2px rgba(139,195,74,.18);}' +
    '.cfgmod-modos label input{width:auto !important;}' +
    '.cfgmod-modos .t{font-weight:600; display:block;}' +
    '.cfgmod-modos .d{color:#6b7a8d; font-size:11px; display:block; margin-top:2px;}';

  // El modal se construye la PRIMERA vez que se abre y después se recicla: no hay
  // por qué tener 4 cajas ocultas en el DOM del tab desde que carga la página.
  function _asegurarModal() {
    if (document.getElementById('cfgModBackdrop')) return;

    var st = document.createElement('style');
    st.id = 'cfgModEstilos';
    st.textContent = ESTILOS;
    document.head.appendChild(st);

    var bd = document.createElement('div');
    bd.id = 'cfgModBackdrop';
    bd.setAttribute('role', 'dialog');
    bd.setAttribute('aria-modal', 'true');
    bd.innerHTML =
      '<div id="cfgModBox">' +
        '<div id="cfgModHead">' +
          '<div><h3 id="cfgModTitulo"></h3><p id="cfgModSub" class="cfgmod-sub"></p></div>' +
          '<button id="cfgModX" title="Cerrar (Esc)" aria-label="Cerrar">✕</button>' +
        '</div>' +
        '<p id="cfgModAviso">⚠ <b>Sin cablear todavía.</b> Esta pantalla MUESTRA con qué valores nace ' +
          'cada barra hoy; no guarda nada y el editor no lee de aquí. Por eso los campos están ' +
          'apagados. Poder editarlos es la iteración siguiente.</p>' +
        '<div id="cfgModCuerpo"></div>' +
      '</div>';
    document.body.appendChild(bd);

    document.getElementById('cfgModX').addEventListener('click', function () { global.cfgModCerrar(); });
    // Clic FUERA de la caja: sólo cuenta si el click fue en el backdrop mismo
    // (si no, arrastrar dentro de una tabla y soltar afuera cerraría el modal).
    bd.addEventListener('click', function (e) { if (e.target === bd) global.cfgModCerrar(); });
  }

  // Esc. Se registra UNA vez a nivel de documento y sale de inmediato si el modal
  // está cerrado, para no pisarle el Escape al Template Editor (que tiene el suyo).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !_abierto) return;
    global.cfgModCerrar();
  });

  global.cfgModAbrir = function (clave) {
    var panel = CFG_PANELES[clave];
    if (!panel) return;
    _asegurarModal();
    document.getElementById('cfgModTitulo').textContent = panel.titulo;
    document.getElementById('cfgModSub').textContent = panel.sub;
    var cuerpo = document.getElementById('cfgModCuerpo');
    cuerpo.innerHTML = panel.html();
    cuerpo.scrollTop = 0;
    document.getElementById('cfgModBackdrop').classList.add('on');
    _abierto = clave;
    _focoPrevio = document.activeElement;
    var x = document.getElementById('cfgModX');
    if (x && x.focus) x.focus();
  };

  global.cfgModCerrar = function () {
    var bd = document.getElementById('cfgModBackdrop');
    if (bd) bd.classList.remove('on');
    _abierto = null;
    // Devolver el foco al botón que abrió el modal: si no, el tabulador vuelve a
    // empezar desde el principio de la página.
    if (_focoPrevio && _focoPrevio.focus) _focoPrevio.focus();
    _focoPrevio = null;
  };

  // Para tests / depuración: la data cruda y los armadores de tabla.
  global.ConfigModelador = {
    CFG_TIPOLOGIAS: CFG_TIPOLOGIAS, CFG_RECUB: CFG_RECUB, CFG_POR_FIGURA: CFG_POR_FIGURA,
    CFG_LARGOS_FILAS: CFG_LARGOS_FILAS, PANELES: CFG_PANELES,
    abierto: function () { return _abierto; }
  };

})(typeof window !== 'undefined' ? window : this);
