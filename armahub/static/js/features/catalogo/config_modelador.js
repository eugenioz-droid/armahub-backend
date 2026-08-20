/* =============================================================================
 * CONFIGURACIÓN DEL MODELADOR — las 4 tablas de la tarjeta «Configuración»
 * (sub-tab Catálogo › Template Editor · tabs/catalogo.html)
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE: los valores con los que NACE cada barra (figura, φ, @ sep, modo
 * de colocación, recubrimiento, largo del gancho) estaban repartidos entre
 * semilla_viga.js, reglas.js, catalogo_figuras.js y template_editor.js. Quien no
 * lea el código no tenía forma de saber con qué se estaba trabajando, ni de
 * cambiarlo sin tocar código.
 *
 * CABLEADA (17-ago). Ahora la data vive en la BASE (tabla modelador_config,
 * migración 106) y se lee/escribe por GET/PUT /modelador/config, a través del
 * módulo compartido features/modelador/config.js (window.ModeladorConfig) — el
 * MISMO que lee el Template Editor al colocar. Una fuente, dos pantallas.
 *
 * QUÉ ESTÁ CABLEADO Y QUÉ NO (esto NO se disimula: cada tabla lo dice arriba):
 *   ✅ Figuras por tipología — figura de partida, φ de partida, @ sep, modo de
 *      colocación y figuras sugeridas del buscador. El editor los aplica al
 *      colocar una barra nueva.
 *   ✅ Recubrimientos — con qué recubrimiento nace cada elemento.
 *   ⚠ Reglas de largos — SE GUARDA pero el motor todavía NO la lee: figura_puntos
 *      .extGancho lleva la pata escrita a mano (20-ago: 10φ, mínimo 7,5 cm). Que
 *      coincida con la config no es que esté cableada: cambiar la config no mueve
 *      una barra. Aplicarlo al motor es un paso aparte que el usuario confirma.
 *   ❌ «Por figura» (lados fijos) — NO existe en el motor: esos campos siguen
 *      apagados. Guardar algo que nadie lee sería peor.
 *   ℹ Redondeo del corte — el motor SÍ redondea desde e8698fe (al centímetro y por
 *      lado: arriba los mínimos normativos, abajo los que topa el hormigón). Lo que
 *      no se puede es ELEGIR otro paso desde acá; la celda va apagada por eso.
 *
 * LA CONFIG DECIDE CON QUÉ NACEN LAS COSAS NUEVAS. Un template ya guardado se
 * abre con SUS valores; nada de acá lo reescribe.
 *
 * SI EL BACKEND NO RESPONDE: la pantalla lo DICE (no muestra una tabla en blanco
 * ni valores inventados) y el editor sigue funcionando con las constantes del
 * código, que son exactamente los valores con los que la config nace.
 * ========================================================================== */
(function (global) {
  'use strict';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ===========================================================================
  // ESTADO — la data VIENE DEL BACKEND (ver cabecera)
  // ===========================================================================
  // _cfg  : la respuesta completa de GET /modelador/config (config + andamiaje:
  //         nombres de tipologías, campos de recubrimiento, diámetros, orden de
  //         elementos). null = todavía no llegó, o falló.
  // _pend : cambios SIN GUARDAR, por sección → { clave: { campo: valor } }. Se
  //         mantienen aunque se cierre el modal: cerrar no es guardar, pero
  //         tampoco puede tirar a la basura lo que el usuario escribió sin avisar.
  var _cfg = null;
  var _pend = { tipologias: {}, recubrimientos: {}, largos: {} };
  var _guardando = false;

  // Colores de elemento: los mismos de TPL_ELEM_COLORES (template_editor.js), para
  // que un MURO se reconozca igual en la lista de templates y aquí.
  var CFG_ELEM_COLORES = {
    MURO: '#795548', LOSA: '#607d8b', VIGA: '#558B2F',
    COLUMNA: '#1565c0', FUNDACION: '#5d4037', GEN: '#616161'
  };

  // Modo de colocación: el motor lo llama 'lineal' y el usuario «Distribución».
  // La traducción vive SÓLO acá (lo que se guarda es siempre el nombre del motor).
  var CFG_MODOS = [['puntual', 'Puntual'], ['lineal', 'Distribución'], ['arreglo', 'Arreglo']];

  function _cfgObj() { return (_cfg && _cfg.config) || null; }

  // Valor VIGENTE en pantalla = lo pendiente si el usuario lo tocó, si no lo guardado.
  function _valor(sec, clave, campo) {
    var p = _pend[sec] && _pend[sec][clave];
    if (p && Object.prototype.hasOwnProperty.call(p, campo)) return p[campo];
    var c = _cfgObj();
    var fila = c && c[sec] && c[sec][clave];
    return fila ? fila[campo] : undefined;
  }

  function _setValor(sec, clave, campo, valor) {
    if (!_pend[sec][clave]) _pend[sec][clave] = {};
    _pend[sec][clave][campo] = valor;
  }

  function _hayPendientes(sec) {
    var p = _pend[sec] || {}, k;
    for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) return true;
    return false;
  }

  function _hayPendientesTodo() {
    return _hayPendientes('tipologias') || _hayPendientes('recubrimientos') || _hayPendientes('largos');
  }

  // Códigos del catálogo de figuras VIGENTE, para el datalist de los campos de
  // figura. Sale del módulo del catálogo (el mismo que usa el editor), resuelto en
  // el momento: si todavía no cargó, el campo sigue siendo texto libre y lo valida
  // el backend — no se inventa una lista propia que se desincronice.
  function _figurasCatalogo() {
    var c = global.ModeladorCatalogoFiguras;
    return (c && typeof c.codigos === 'function') ? c.codigos() : [];
  }

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
    if (!figs || !figs.length) {
      // [] es un DATO: esta tipología no tiene sugeridas, así que el buscador del
      // editor muestra el catálogo completo. No es un error ni un campo vacío.
      return '<span class="cfgmod-pie">sin sugeridas → el buscador muestra todo el catálogo</span>';
    }
    return figs.map(function (f) {
      // El chip verde marca la figura por defecto DENTRO de las sugeridas: si la
      // por defecto no estuviera en la lista, se vería de inmediato (ninguna verde).
      return '<span class="cfgmod-chip' + (f === def ? ' def' : '') + '">' + _esc(f) + '</span>';
    }).join('');
  }

  // --------------------------------------------------------------------------
  // CAMPOS EDITABLES
  // --------------------------------------------------------------------------
  // Cada campo lleva sección / clave / campo en atributos data-*: un ÚNICO listener
  // delegado en el cuerpo del modal los recoge (los inputs se repintan enteros en
  // cada render, así que listeners por-campo morirían con el innerHTML).
  // `_ro()` es para los campos que existen pero NO se editan (tablas fijas de
  // Fabricación/NCh 211, o controles que el motor todavía no lee): van
  // deshabilitados Y con el motivo en el title, nunca apagados sin explicación.
  function _data(sec, clave, campo) {
    return ' data-cfg-sec="' + _esc(sec) + '" data-cfg-key="' + _esc(clave) +
           '" data-cfg-campo="' + _esc(campo) + '"';
  }
  function _inpNum(sec, clave, campo, valor, extra) {
    return '<input type="number" step="0.5" min="0" class="cfgmod-w70"' + _data(sec, clave, campo) +
      ' value="' + _esc(valor == null ? '' : valor) + '"' + (extra || '') + '>';
  }
  function _inpTexto(sec, clave, campo, valor, extra) {
    return '<input type="text"' + _data(sec, clave, campo) +
      ' value="' + _esc(valor == null ? '' : valor) + '"' + (extra || '') + '>';
  }
  // opciones = [[valor, etiqueta], …]. `vacio` agrega la opción "sin definir", que
  // es un valor legítimo (una tipología puede no tener figura de partida).
  function _inpSel(sec, clave, campo, opciones, elegida, vacio) {
    var html = '<select' + _data(sec, clave, campo) + '>';
    if (vacio) {
      html += '<option value=""' + ((elegida == null || elegida === '') ? ' selected' : '') + '>' +
        _esc(vacio) + '</option>';
    }
    html += opciones.map(function (o) {
      var v = o[0], t = o[1];
      return '<option value="' + _esc(v) + '"' +
        (String(v) === String(elegida) ? ' selected' : '') + '>' + _esc(t) + '</option>';
    }).join('');
    return html + '</select>';
  }
  function _ro(valor, motivo) {
    return '<input class="cfgmod-w70" value="' + _esc(valor == null ? '' : valor) +
      '" disabled title="' + _esc(motivo) + '">';
  }

  // --- 1 · FIGURAS POR TIPOLOGÍA -------------------------------------------
  // La clave es ELEMENTO-TIPOLOGÍA, no la tipología sola: una ES de viga y una EC
  // de muro son filas distintas. La lista de elementos, el orden y los nombres de
  // cada tipología los manda el backend (tipologias_catalogo), que es la misma
  // semilla que siembra el catálogo — acá no se lleva una copia.
  function _htmlTipologias() {
    var c = _cfgObj();
    var figsCat = _figurasCatalogo();
    var datalist = '<datalist id="cfgmodFigs">' +
      figsCat.map(function (f) { return '<option value="' + _esc(f) + '">'; }).join('') + '</datalist>';
    var diams = (_cfg.diametros || []).map(function (d) { return [d, d]; });

    return datalist +
      '<div class="cfgmod-nota">La clave real es <b>elemento + tipología</b>, no la tipología ' +
      'sola: una <b>ES</b> de viga y una <b>EC</b> de muro son filas distintas. Lo que se guarda acá ' +
      'es con qué nacen las barras <b>nuevas</b>: un template ya guardado no cambia.</div>' +
      (_cfg.elementos || []).map(function (elem) {
        var tipos = (_cfg.tipologias_catalogo || {})[elem] || [];
        if (!tipos.length) return '';
        var col = CFG_ELEM_COLORES[elem] || '#607d8b';
        var sinDefinir = 0;
        var filas = tipos.map(function (t) {
          var cod = t[0], nombre = t[1], clave = elem + '-' + cod;
          var fila = (c.tipologias && c.tipologias[clave]) || {};
          var fig = _valor('tipologias', clave, 'figura');
          var diam = _valor('tipologias', clave, 'diam');
          var sep = _valor('tipologias', clave, 'sep');
          var modo = _valor('tipologias', clave, 'modo');
          var sugeridas = _valor('tipologias', clave, 'figuras');
          if (!Array.isArray(sugeridas)) sugeridas = fila.figuras || [];
          if (!fig || !diam) sinDefinir++;
          return '<tr>' +
            '<td><b>' + _esc(cod) + '</b> · ' + _esc(nombre) + '</td>' +
            '<td>' + _inpTexto('tipologias', clave, 'figura', fig,
                ' list="cfgmodFigs" placeholder="sin definir" style="width:110px"') + '</td>' +
            '<td>' +
              _inpTexto('tipologias', clave, 'figuras', sugeridas.join(', '),
                ' placeholder="sin sugeridas" title="Códigos separados por coma. Son las que el buscador del editor ofrece primero."') +
              '<div class="cfgmod-chipbox">' + _chips(sugeridas, fig) + '</div>' +
            '</td>' +
            '<td class="num">' + _inpSel('tipologias', clave, 'diam', diams, diam, '—') + '</td>' +
            '<td class="num">' + _inpNum('tipologias', clave, 'sep', sep) + '</td>' +
            '<td>' + _inpSel('tipologias', clave, 'modo', CFG_MODOS, modo) + '</td>' +
          '</tr>';
        }).join('');

        return '<div class="cfgmod-card">' +
          '<h4><span class="cfgmod-elem" style="background:' + col + ';">' + _esc(elem) + '</span></h4>' +
          '<p class="cfgmod-sub">La <b>figura</b> y el <b>φ</b> son con los que se prellena el ribbon al ' +
          'elegir la tipología. Las <b>sugeridas</b> son las que el buscador ofrece primero; escribiendo ' +
          'se llega a cualquiera del catálogo.</p>' +
          '<table><thead><tr>' +
            '<th style="width:210px">Tipología</th>' +
            '<th style="width:130px">Figura por defecto</th>' +
            '<th>Figuras sugeridas</th>' +
            '<th class="num" style="width:90px">φ mm</th>' +
            '<th class="num" style="width:80px">@ sep cm</th>' +
            '<th style="width:140px">Colocación</th>' +
          '</tr></thead><tbody>' + filas + '</tbody></table>' +
          (sinDefinir
            ? '<p class="cfgmod-pie">' + sinDefinir + ' de estas tipologías no tiene figura o φ de ' +
              'partida: nunca los tuvo escritos en el código y no se inventaron. El ribbon las deja ' +
              'vacías hasta que las llenes aquí.</p>'
            : '') +
        '</div>';
      }).join('') +
      '<p class="cfgmod-pie">De dónde salieron los valores iniciales: <b>@ sep</b> y <b>colocación</b>, ' +
      'de las tablas que el modelador ya usaba (40 en trabas, 20 en el resto; el preset de modo por ' +
      'tipología). Las <b>sugeridas</b>, del catálogo de figuras. La <b>figura</b> y el <b>φ</b> no ' +
      'existían en el código: los de viga vienen de la viga-semilla y los de muro son la propuesta que ' +
      'esta pantalla mostraba desde ayer — ahora sí los usa el editor.</p>';
  }

  // --- 2 · REGLAS DE LARGOS -------------------------------------------------
  function _htmlLargos() {
    var c = _cfgObj();
    var modo = _valor('largos', 'modo', 'valor');
    if (modo === undefined) modo = (c.largos && c.largos.modo) || 'fabricacion';
    var custom = (_pend.largos.custom || {});
    var cbase = (c.largos && c.largos.custom) || {};
    var cFactor = (custom.factor !== undefined) ? custom.factor : cbase.factor;
    var cMin = (custom.min !== undefined) ? custom.min : cbase.min;
    var gm = _cfg.gancho_motor || {};
    var ga = _cfg.gancho_activo || {};

    var MODOS = [
      { v: 'fabricacion', t: 'Fabricación', on: true,
        d: 'Lo que hace el taller: pata = 10 × φ, pareja para todos los diámetros.' },
      { v: 'nch211', t: 'NCh 211', on: !!_cfg.nch211_disponible,
        d: 'Según norma, con valores por rango de diámetro.' },
      { v: 'custom', t: 'Custom', on: true,
        d: 'Tú defines la pata. Se usa cuando la especificación del proyecto manda otra cosa.' }
    ];

    // EL AVISO SE ARMA CON LOS DOS NÚMEROS DE VERDAD, no con uno supuesto (fix 20-ago).
    // Esta frase decía «pasar de Xφ a 10φ mueve largos de corte y kilos» con la X del
    // motor: cuando el motor pasó a 10φ esa misma mañana, la pantalla quedó diciendo
    // «pasar de 10φ a 10φ mueve largos», que no es una exageración sino una mentira.
    // Lo único que NO cambió —y es lo que hay que decir siempre— es que el motor no lee
    // esta pantalla: la pata la lleva escrita en el código.
    var mismaPata = (ga.factor != null && Number(ga.factor) === Number(gm.factor) &&
                     Number(ga.min) === Number(gm.min));
    var txtMotor = _esc(gm.factor) + ' × φ (mínimo ' + _esc(gm.min) + ' cm)';
    var txtCfg = (ga.factor == null) ? 'sin valor'
      : (_esc(ga.factor) + ' × φ (mínimo ' + _esc(ga.min) + ' cm)');

    return '<div class="cfgmod-nota"><b>⚠ Esto se guarda, pero el motor todavía NO lo lee.</b> ' +
      'Al armar la barra, el modelador dobla la pata a <b>' + txtMotor + '</b>, un número escrito a ' +
      'mano en el código; acá la configuración dice <b>' + txtCfg + '</b>. ' +
      (mismaPata
        ? 'Hoy los dos dicen lo mismo, así que guardar tal cual no mueve ni una barra. Pero si ' +
          'cambias la pata en esta pantalla, el taller va a seguir recibiendo largos calculados ' +
          'con ' + txtMotor + ': hacer que el motor lea esta pantalla es un trabajo aparte que ' +
          'hay que pedir.'
        : 'O sea que lo que está escrito acá <b>no se está aplicando a ninguna barra</b>: los ' +
          'largos de corte y los kilos siguen saliendo con ' + txtMotor + '.') +
      ' Y para que se vea que esto no es un detalle: el día que la pata pasó de 6φ a 10φ ' +
      '(20-ago, ya aplicado) los kilos se movieron —en una viga armada como la arma hoy el ' +
      'editor, +1,2 kg de 136,2 → 137,4; con estribo 106A φ16, +10,7 kg de 234,9 → 245,6—, ' +
      'así que cambiarla es cambiar lo que se factura.</div>' +
      '<div class="cfgmod-card">' +
        '<h4>Modo de norma</h4>' +
        '<p class="cfgmod-sub">El modo fija la pata del gancho. «Fabricación» es una tabla fija (por ' +
        'eso sus campos no se editan); en «Custom» escribes tú los números.</p>' +
        '<div class="cfgmod-modos">' +
          MODOS.map(function (m) {
            var sel = (m.v === modo);
            return '<label class="' + (sel ? 'on' : '') + (m.on ? '' : ' off') + '"' +
              (m.on ? '' : ' title="Este modo no tiene tabla cargada: nadie escribió sus valores por rango de diámetro y no se van a inventar."') + '>' +
              '<input type="radio" name="cfgmod-modo" value="' + _esc(m.v) + '"' +
              _data('largos', 'modo', 'valor') + (sel ? ' checked' : '') + (m.on ? '' : ' disabled') + '>' +
              '<span><span class="t">' + _esc(m.t) + (m.on ? '' : ' — sin tabla cargada') + '</span>' +
              '<span class="d">' + _esc(m.d) + '</span></span></label>';
          }).join('') +
        '</div>' +
        '<table><thead><tr>' +
          '<th style="width:220px">Diámetro</th>' +
          '<th class="num" style="width:150px">Pata del gancho (× φ)</th>' +
          '<th class="num" style="width:150px">Mínimo absoluto (cm)</th>' +
          '<th>Comentario</th>' +
        '</tr></thead><tbody>' +
        (modo === 'custom'
          ? '<tr><td>Todos los diámetros</td>' +
            '<td class="num">' + _inpNum('largos', 'custom', 'factor', cFactor) + '</td>' +
            '<td class="num">' + _inpNum('largos', 'custom', 'min', cMin) + '</td>' +
            '<td class="cfgmod-pie" style="margin:0">Una sola pareja de valores. La tabla POR RANGO de ' +
            'diámetro es lo que necesitaría NCh 211, y esa tabla todavía no existe.</td></tr>'
          : '<tr><td>Todos los diámetros</td>' +
            '<td class="num">' + _ro(ga.factor, 'Tabla fija del modo «' + modo + '»: se cambia eligiendo Custom.') + '</td>' +
            '<td class="num">' + _ro(ga.min, 'Tabla fija del modo «' + modo + '»: se cambia eligiendo Custom.') + '</td>' +
            '<td class="cfgmod-pie" style="margin:0">Tabla fija del modo elegido: no se edita.</td></tr>') +
        '</tbody></table>' +
        '<p class="cfgmod-pie">El <b>ángulo</b> del gancho no se configura acá: lo trae cada figura del ' +
        'catálogo (los 135° de una 104D, los 45° de una 106A). Cambiarlo es editar la figura.</p>' +
      '</div>' +
      '<div class="cfgmod-card">' +
        '<h4>Redondeo del corte <span class="cfgmod-pie">— fijo en 1 cm: no se elige acá</span></h4>' +
        '<p class="cfgmod-sub">Las barras no se cortan con decimales, y el modelador ya no los entrega: ' +
        '<b>redondea al centímetro, lado por lado</b>. Los lados que fija una ' +
        'norma —las patas del gancho— <b>suben</b> al centímetro de arriba, para que no queden bajo el ' +
        'mínimo; los que limita el hormigón —los que salen de la luz útil o del marco interior del ' +
        'estribo— <b>bajan</b> al de abajo, para no meter el fierro dentro del recubrimiento. El largo ' +
        'total es la suma de los lados ya redondeados, y la barra se dibuja con ese mismo número: lo ' +
        'que se ve en pantalla es lo que se corta. Un lado que <b>tú</b> escribiste no se toca nunca, ' +
        'salga redondo o no. Lo que <b>no</b> está cableado es elegir <i>otro</i> paso de redondeo desde ' +
        'acá: el centímetro está escrito en el código, y por eso la celda va apagada.</p>' +
        '<table><tbody>' +
        '<tr><td style="width:340px">Redondear las medidas a</td>' +
        '<td style="width:220px">' + _ro('1 cm (lo que hace hoy)', 'El paso está escrito en el código: esta celda no lo cambia.') + '</td>' +
        '<td class="cfgmod-pie" style="margin:0">Se aplica lado por lado y sólo a los lados que resuelve ' +
        'el modelador: arriba los mínimos de norma, abajo los que topa el hormigón.</td></tr>' +
        '</tbody></table>' +
      '</div>';
  }

  // --- 3 · RECUBRIMIENTOS ---------------------------------------------------
  // Los CAMPOS de cada elemento los manda el backend (recubrimientos_campos), que es
  // el espejo de TPL_DIMS_POR_ELEMENTO: la viga tiene tres independientes, el muro
  // UNO que escribe caras y bordes, la losa no tiene lateral. Antes esta tabla
  // pintaba siempre sup/inf/lat y repetía el mismo número tres veces, lo que hacía
  // creer que eran tres campos.
  function _htmlRecub() {
    var campos = _cfg.recubrimientos_campos || {};
    return '<div class="cfgmod-card">' +
      '<h4>Recubrimientos por defecto</h4>' +
      '<p class="cfgmod-sub">Con qué recubrimiento nace cada tipo de elemento. Se puede cambiar dentro ' +
      'de cada template; esto es sólo el valor de partida.</p>' +
      '<table><thead><tr>' +
        '<th style="width:170px">Elemento</th>' +
        '<th>Campos de recubrimiento (cm)</th>' +
        '<th style="width:280px">Qué escribe</th>' +
      '</tr></thead><tbody>' +
      (_cfg.elementos || []).map(function (elem) {
        var lista = campos[elem] || [];
        if (!lista.length) return '';
        var col = CFG_ELEM_COLORES[elem] || '#607d8b';
        var celdas = lista.map(function (campo) {
          var v = _valor('recubrimientos', elem, campo.k);
          return '<span class="cfgmod-campo"><label>' + _esc(campo.lbl) + '</label>' +
            _inpNum('recubrimientos', elem, campo.k, v) + '</span>';
        }).join('');
        var notas = lista.map(function (campo) {
          return campo.nota ? (campo.lbl + ': ' + campo.nota)
                            : (campo.ks.length > 1 ? campo.lbl + ': escribe ' + campo.ks.join(' + ') : null);
        }).filter(Boolean);
        return '<tr>' +
          '<td><span class="cfgmod-elem" style="background:' + col + ';">' + _esc(elem) + '</span></td>' +
          '<td>' + celdas + '</td>' +
          '<td class="cfgmod-pie" style="margin:0">' +
            _esc(notas.length ? notas.join(' · ') : 'Un campo por cara, independientes') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<p class="cfgmod-pie">Cada elemento tiene los campos que tiene: el muro define <b>uno solo</b> ' +
      '(escribe caras y bordes con el mismo número) y la losa <b>no tiene lateral</b>. Eso es el dato, ' +
      'no un hueco por llenar.</p>' +
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
      'todavía no tiene efecto en ninguna barra. Por eso <b>esta tabla no guarda</b> y no tiene ' +
      'botón: no hay nada en el motor que pudiera leerla, y guardar algo que nadie aplica sería ' +
      'peor que no ofrecerlo.</p>' +
    '</div>';
  }

  // Cada panel: título, bajada, la función que arma su tabla y la SECCIÓN del
  // backend que guarda (null = este panel no guarda nada porque no hay nada
  // cableado que guardar; su botón de guardar ni aparece). La clave es la que llega
  // desde el onclick del HTML.
  var CFG_PANELES = {
    tipologias: {
      titulo: '📐 Figuras por tipología',
      sub: 'Con qué figura, φ, separación y modo de colocación nace cada tipología, por elemento.',
      html: _htmlTipologias, seccion: 'tipologias'
    },
    largos: {
      titulo: '📏 Reglas de largos',
      sub: 'El modo de norma que fija la pata del gancho. El motor todavía no lo lee.',
      html: _htmlLargos, seccion: 'largos'
    },
    recub: {
      titulo: '🧱 Recubrimientos',
      sub: 'El recubrimiento con el que nace cada tipo de elemento.',
      html: _htmlRecub, seccion: 'recubrimientos'
    },
    figura: {
      titulo: '📎 Por figura',
      sub: 'Qué lado de cada familia de figura nace en automático y cuál queda fijo.',
      html: _htmlPorFigura, seccion: null
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
    // Los campos EDITABLES van en blanco con texto oscuro; los deshabilitados
    // conservan el gris apagado de antes. Que se vea de un vistazo qué se puede
    // tocar y qué no es justamente lo que faltaba cuando todo estaba apagado.
    '.cfgmod-card input,.cfgmod-card select{font:inherit; border:1px solid #dbe1e8; border-radius:6px;' +
      ' padding:4px 6px; background:#fff; color:#1f2a37; width:100%;}' +
    '.cfgmod-card input:focus,.cfgmod-card select:focus{outline:none; border-color:#8BC34A;' +
      ' box-shadow:0 0 0 2px rgba(139,195,74,.18);}' +
    '.cfgmod-card input:disabled,.cfgmod-card select:disabled{background:#f2f4f7; color:#8a97a6;}' +
    '.cfgmod-w70{width:70px !important;}' +
    '.cfgmod-chipbox{margin-top:4px;}' +
    '.cfgmod-campo{display:inline-flex; align-items:center; gap:6px; margin:0 14px 4px 0;}' +
    '.cfgmod-campo label{font-size:11px; color:#6b7a8d; white-space:nowrap;}' +
    '#cfgModPie{display:flex; align-items:center; gap:12px; padding:11px 18px;' +
      ' border-top:1px solid #e3e8ef; background:#fff;}' +
    '#cfgModDirty{font-size:12px; color:#b26a00; font-weight:600;}' +
    '#cfgModMsg{font-size:12px; border-radius:7px; padding:6px 10px; display:none; flex:1;}' +
    '#cfgModGuardar{margin-left:auto; font-size:13px; font-weight:700; padding:8px 18px;' +
      ' background:#8BC34A; color:#fff; border:none; border-radius:8px; cursor:pointer;}' +
    '#cfgModGuardar:disabled{opacity:.45; cursor:default;}' +
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
    '.cfgmod-modos label.off{opacity:.55; background:#f7f9fc;}' +
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
        '<p id="cfgModAviso" style="display:none;"></p>' +
        '<div id="cfgModCuerpo"></div>' +
        '<div id="cfgModPie">' +
          '<span id="cfgModDirty"></span>' +
          '<span id="cfgModMsg"></span>' +
          '<button id="cfgModGuardar" disabled>Guardar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bd);

    document.getElementById('cfgModX').addEventListener('click', function () { global.cfgModCerrar(); });
    // Clic FUERA de la caja: sólo cuenta si el click fue en el backdrop mismo
    // (si no, arrastrar dentro de una tabla y soltar afuera cerraría el modal).
    bd.addEventListener('click', function (e) { if (e.target === bd) global.cfgModCerrar(); });
    document.getElementById('cfgModGuardar').addEventListener('click', _guardar);

    // UN listener delegado para TODOS los campos: el cuerpo se repinta entero en
    // cada render, así que listeners por-campo morirían con el innerHTML.
    var cuerpo = document.getElementById('cfgModCuerpo');
    cuerpo.addEventListener('change', _onCampo);
    cuerpo.addEventListener('input', _onCampo);
  }

  // -------------------------------------------------------------------------
  // CAPTURA DE CAMBIOS
  // -------------------------------------------------------------------------
  // El valor se normaliza ACÁ, una sola vez, al shape que espera el backend: número
  // para φ/@sep/recubrimientos, código en mayúsculas para las figuras, lista para las
  // sugeridas. Así el PUT nunca manda un string donde va un número.
  function _onCampo(ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) return;
    var sec = el.getAttribute('data-cfg-sec');
    if (!sec) return;
    var clave = el.getAttribute('data-cfg-key');
    var campo = el.getAttribute('data-cfg-campo');
    var v = el.value;

    if (sec === 'tipologias') {
      if (campo === 'figura') {
        v = String(v || '').trim().toUpperCase() || null;
      } else if (campo === 'diam') {
        v = (String(v).trim() === '') ? null : Number(v);
      } else if (campo === 'sep') {
        v = Number(v);
        if (!isFinite(v)) return;      // campo a medio escribir: no se guarda basura
      } else if (campo === 'figuras') {
        // Códigos separados por coma/espacio. Se deduplica preservando el orden: el
        // orden ES el dato (el buscador ofrece las primeras primero).
        var vistos = {}, out = [];
        String(v || '').split(/[\s,;]+/).forEach(function (f) {
          var k = f.trim().toUpperCase();
          if (k && !vistos[k]) { vistos[k] = 1; out.push(k); }
        });
        v = out;
      }
      _setValor('tipologias', clave, campo, v);
    } else if (sec === 'recubrimientos') {
      v = Number(v);
      if (!isFinite(v)) return;
      // Un campo con `ks` (el «Recub» del muro) escribe VARIAS claves: es un solo
      // control por diseño, y guardar sólo una dejaría la config a medias.
      var campos = ((_cfg.recubrimientos_campos || {})[clave] || []);
      var ks = [campo];
      campos.forEach(function (c) { if (c.k === campo && c.ks && c.ks.length) ks = c.ks; });
      ks.forEach(function (k) { _setValor('recubrimientos', clave, k, v); });
    } else if (sec === 'largos') {
      if (clave === 'modo') {
        _pend.largos.modo = String(v);
        // Cambiar de modo cambia qué campos se editan (Custom sí, los demás no):
        // hay que repintar la tabla, no sólo marcar el cambio.
        _render();
        return;
      }
      v = Number(v);
      if (!isFinite(v)) return;
      if (!_pend.largos.custom) _pend.largos.custom = {};
      _pend.largos.custom[campo] = v;
    }
    _pintarPie();
    // Los chips de sugeridas son un espejo de lo escrito: si no se repintan, el
    // usuario ve la lista vieja debajo del campo que acaba de cambiar.
    if (sec === 'tipologias' && campo === 'figuras') _repintarChips(el, clave);
  }

  function _repintarChips(input, clave) {
    var box = input.parentNode && input.parentNode.querySelector('.cfgmod-chipbox');
    if (!box) return;
    var figs = _valor('tipologias', clave, 'figuras') || [];
    box.innerHTML = _chips(figs, _valor('tipologias', clave, 'figura'));
  }

  // -------------------------------------------------------------------------
  // MENSAJES Y PIE
  // -------------------------------------------------------------------------
  // Verde = hecho · rojo = no se pudo, con el motivo del backend TAL CUAL (mismo
  // patrón que _tplMsg del gestor de templates). Nada de alert().
  function _msg(texto, error) {
    var box = document.getElementById('cfgModMsg');
    if (!box) return;
    if (!texto) { box.style.display = 'none'; box.textContent = ''; return; }
    box.style.display = 'block';
    box.style.color = error ? '#c62828' : '#33691e';
    box.style.background = error ? '#fff6f5' : '#f7fbf2';
    box.style.border = '1px solid ' + (error ? '#f3c6c2' : '#d7e8c2');
    box.textContent = texto;
  }

  function _pintarPie() {
    var panel = CFG_PANELES[_abierto];
    var pie = document.getElementById('cfgModPie');
    var btn = document.getElementById('cfgModGuardar');
    var dirty = document.getElementById('cfgModDirty');
    if (!pie || !btn || !dirty) return;
    // Panel sin sección (Por figura): no hay nada que guardar, el pie desaparece.
    if (!panel || !panel.seccion) { pie.style.display = 'none'; return; }
    pie.style.display = 'flex';
    var hay = _hayPendientes(panel.seccion);
    dirty.textContent = hay ? '● Cambios sin guardar' : '';
    btn.disabled = !hay || _guardando || !_cfgObj();
    btn.textContent = _guardando ? 'Guardando…' : 'Guardar';
  }

  // -------------------------------------------------------------------------
  // GUARDAR
  // -------------------------------------------------------------------------
  // PUT sólo de LA SECCIÓN del panel abierto: cada modal guarda lo suyo y no puede
  // pisar lo que otro usuario cambió en otra sección (el backend hace la mezcla).
  function _guardar() {
    var panel = CFG_PANELES[_abierto];
    if (!panel || !panel.seccion || _guardando) return;
    var sec = panel.seccion;
    if (!_hayPendientes(sec)) return;

    var cuerpoEnv = {};
    if (sec === 'largos') {
      // 'largos' no es un mapa de filas: es el bloque tal cual (modo + custom).
      cuerpoEnv.largos = {};
      if (_pend.largos.modo !== undefined) cuerpoEnv.largos.modo = _pend.largos.modo;
      if (_pend.largos.custom) cuerpoEnv.largos.custom = _pend.largos.custom;
    } else {
      cuerpoEnv[sec] = _pend[sec];
    }
    // Se recuerda LO QUE SE ENVÍA: si el usuario sigue editando mientras la petición
    // está en vuelo, esos cambios NO están en el servidor y tienen que seguir
    // contando como pendientes (mismo criterio que _sellarGuardado del editor).
    var enviado = JSON.parse(JSON.stringify(_pend[sec]));

    _guardando = true;
    _msg('');
    _pintarPie();

    var url = (typeof global.apiUrl === 'function') ? global.apiUrl('/modelador/config') : '/modelador/config';
    var headers = Object.assign({ 'Content-Type': 'application/json' },
      (typeof global.authHeaders === 'function' ? global.authHeaders() : {}));

    fetch(url, { method: 'PUT', headers: headers, body: JSON.stringify(cuerpoEnv) })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        _guardando = false;
        if (!res.ok) {
          // El backend manda `detail` en castellano (permiso, figura inexistente,
          // NCh 211 sin tabla…): se muestra TAL CUAL, no un "HTTP 422" pelado.
          var det = res.data && res.data.detail;
          _msg(det ? String(det) : ('No se pudo guardar (HTTP ' + res.status + ').'), true);
          _pintarPie();
          return;
        }
        // Sólo se dan por guardados los campos QUE SE ENVIARON.
        Object.keys(enviado).forEach(function (k) {
          if (_pend[sec][k] && JSON.stringify(_pend[sec][k]) === JSON.stringify(enviado[k])) {
            delete _pend[sec][k];
          }
        });
        if (sec === 'largos' && !_hayPendientes('largos')) _pend.largos = {};
        // La respuesta del PUT ya trae la config completa: se aplica al módulo
        // compartido para que el Template Editor que se abra a continuación vea lo
        // recién guardado sin un GET extra.
        var cfg = global.ModeladorConfig;
        if (cfg && cfg.aplicar && cfg.aplicar(res.data)) _cfg = cfg.datos();
        _render();
        _msg('Guardado. Las barras que coloques a partir de ahora nacen con estos valores.', false);
      })
      .catch(function (e) {
        _guardando = false;
        _msg('No se pudo guardar: ' + ((e && e.message) || 'sin conexión con el servidor') + '.', true);
        _pintarPie();
      });
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  function _render() {
    var panel = CFG_PANELES[_abierto];
    var cuerpo = document.getElementById('cfgModCuerpo');
    if (!panel || !cuerpo) return;
    var aviso = document.getElementById('cfgModAviso');

    if (!_cfgObj()) {
      // SIN CONFIG NO SE PINTA UNA TABLA: mostrar los valores "por si acaso" haría
      // creer que están guardados. Se dice qué pasó y qué sigue rigiendo.
      var motivo = (global.ModeladorConfig && global.ModeladorConfig.error) ?
        global.ModeladorConfig.error() : null;
      cuerpo.innerHTML = '<div class="cfgmod-nota"><b>No se pudo leer la configuración</b>' +
        (motivo ? ' (' + _esc(motivo) + ')' : '') + '. No se muestran valores para no hacer creer ' +
        'que son los guardados. Mientras tanto el modelador sigue funcionando con los valores ' +
        'escritos en el código, que son exactamente aquellos con los que esta configuración nace. ' +
        'Vuelve a abrir esta ventana para reintentar.</div>';
      if (aviso) aviso.style.display = 'none';
      _pintarPie();
      return;
    }

    if (aviso) {
      // Quién y cuándo tocó esto por última vez. Sin fila guardada se dice que rigen
      // los valores de fábrica, que no es lo mismo que "nadie configuró nada".
      aviso.style.display = 'block';
      aviso.innerHTML = _cfg.guardada
        ? ('Última modificación: <b>' + _esc(_cfg.actualizado_por || '—') + '</b> · ' +
           _esc(String(_cfg.actualizado_fecha || '').slice(0, 10)))
        : 'Todavía nadie guardó esta configuración: rigen los valores de partida, que son los ' +
          'que el modelador ya usaba. Guardar aquí crea la configuración.';
    }
    cuerpo.innerHTML = panel.html();
    cuerpo.scrollTop = 0;
    _pintarPie();
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
    document.getElementById('cfgModBackdrop').classList.add('on');
    _abierto = clave;
    _focoPrevio = document.activeElement;
    _msg('');

    var cuerpo = document.getElementById('cfgModCuerpo');
    var cfg = global.ModeladorConfig;
    _cfg = (cfg && cfg.datos) ? cfg.datos() : null;
    if (!_cfg && cfg && cfg.cargar) {
      // Primera apertura: la config todavía no llegó. Se DICE que está cargando en
      // vez de pintar una tabla vacía que después salta.
      cuerpo.innerHTML = '<div class="cfgmod-pie">Cargando configuración…</div>';
      document.getElementById('cfgModPie').style.display = 'none';
      cfg.cargar().then(function () {
        if (_abierto !== clave) return;   // el usuario ya cerró o cambió de panel
        _cfg = cfg.datos();
        _render();
      });
    } else {
      _render();
    }

    var x = document.getElementById('cfgModX');
    if (x && x.focus) x.focus();
  };

  global.cfgModCerrar = function () {
    // Cerrar NO guarda. Se avisa antes de perder lo escrito (mismo patrón que el
    // Template Editor). Si el usuario decide seguir, los pendientes se descartan:
    // dejarlos vivos haría que el modal reabriera mostrando cambios "fantasma"
    // que el servidor no tiene.
    var panel = CFG_PANELES[_abierto];
    if (panel && panel.seccion && _hayPendientes(panel.seccion) && !_guardando) {
      if (!global.confirm('Hay cambios sin guardar en esta configuración. ¿Cerrar igual?')) return;
      _pend[panel.seccion] = {};
    }
    var bd = document.getElementById('cfgModBackdrop');
    if (bd) bd.classList.remove('on');
    _abierto = null;
    // Devolver el foco al botón que abrió el modal: si no, el tabulador vuelve a
    // empezar desde el principio de la página.
    if (_focoPrevio && _focoPrevio.focus) _focoPrevio.focus();
    _focoPrevio = null;
  };

  // Para tests / depuración. La data ya NO vive acá (viene del backend): se expone
  // el estado real para poder verificarlo.
  global.ConfigModelador = {
    CFG_POR_FIGURA: CFG_POR_FIGURA, PANELES: CFG_PANELES,
    abierto: function () { return _abierto; },
    config: function () { return _cfg; },
    pendientes: function () { return _pend; },
    guardar: _guardar
  };

})(typeof window !== 'undefined' ? window : this);
