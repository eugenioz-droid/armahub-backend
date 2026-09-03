// =============================================================================
// asistente.js — ASISTENTE IA DE ENFIERRADO (SPECS_ARMAHUB.md §12) · Etapa 2.
//
// Cablea el botón 🤖 IA del Template Editor y el panel de chat que REEMPLAZA al
// panel de componentes (#te_side) mientras está abierto — el 3D queda siempre
// visible. Conectado de verdad: cada Enviar hace POST /api/v1/asistente/chat
// (backend → API Anthropic) con el HISTORIAL COMPLETO + la receta ACTUAL del
// editor (§12.2.6, vía templateEditorEstado()). Respuesta EN BLOQUE (opción A):
// burbuja «Pensando…» y luego el texto completo.
//
// PERSISTENCIA (§12.3): la conversación vive en memoria de sesión. Minimizar NO
// la pierde; ABRIR OTRO ELEMENTO la reinicia (muro nuevo = chat nuevo) — se
// detecta leyendo el contador `global.__teAperturas` que estampa
// templateEditorAbrir (ver _reiniciarSiOtroElemento). F5 la pierde (F1).
//
// Al llegar una receta se INSTALA EN VIVO: el hormigón primero y las barras de a
// una (templateEditorAgregarComponente, la misma puerta del clic manual), con una
// pausa corta entre medio — el usuario ve el muro armándose. El botón del panel
// vuelve a cargarla completa de una. No se guarda nada (§12.2.5).
//
// El markup y el CSS viven en template_editor_modal.html (scopeados, 3 temas).
// =============================================================================
(function (global) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // Conversación de la sesión: [{rol:'user'|'asistente', texto}]. Muere con la
  // página o al abrir otro elemento.
  var CHAT = [];
  var ABIERTO = false;
  var PENSANDO = false;
  var PROPUESTA = null;      // { receta, resumen } de la última respuesta con receta
  var _aplicandoIA = false;  // true mientras Cargar-como-borrador reabre el editor
  var _selloVisto = null;    // ultimo global.__teAperturas que vio el chat

  // ---------------------------------------------------------------------------
  // BACKEND
  // ---------------------------------------------------------------------------
  function _authHeaders() {
    var t = localStorage.getItem('armahub_token');
    var h = { 'Content-Type': 'application/json' };
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }

  function _estadoEditor() {
    try {
      return (typeof global.templateEditorEstado === 'function')
        ? global.templateEditorEstado() : null;
    } catch (e) { return null; }
  }

  function _preguntar() {
    var est = _estadoEditor();
    var body = {
      historial: CHAT.slice(),
      receta_actual: (est && est.receta) || null,
      elemento: (est && est.elemento) || 'muro',
      obra: (est && est.ctxObra && est.ctxObra.id_proyecto) || (est && est.obra) || null
    };
    return fetch('/api/v1/asistente/chat', {
      method: 'POST', headers: _authHeaders(), body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          // 502/503 SIN detalle = no contesto la app, contesto el proxy: el
          // servidor esta reiniciando (deploy) o caido. Decirlo tal cual, porque
          // "el asistente no respondio" manda a buscar el problema donde no esta
          // (le paso al usuario justo durante un deploy, 31-ago).
          var msg = (d && d.detail)
            || ((r.status === 502 || r.status === 503)
                ? 'El servidor no está respondiendo (puede estar actualizándose). Espera unos segundos y reintenta.'
                : ('El asistente no respondió (' + r.status + ').'));
          throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        return d;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // MENSAJES
  // ---------------------------------------------------------------------------
  function _burbuja(rol, texto) {
    var box = $('te_iaMsgs');
    if (!box) return null;
    var d = document.createElement('div');
    d.className = 'te-ia-msg ' + (rol === 'user' ? 'user' : 'bot');
    d.textContent = texto;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
  }

  function _pintarMsgs() {
    var box = $('te_iaMsgs');
    if (!box) return;
    box.innerHTML = '';
    CHAT.forEach(function (m) { _burbuja(m.rol, m.texto); });
  }

  function _agregar(rol, texto) {
    CHAT.push({ rol: rol, texto: texto });
    _burbuja(rol, texto);
  }

  // Alto del campo de escritura segun su contenido. El tope real lo pone el CSS
  // (max-height); aca solo se mide el texto y se deja el scroll cuando ya no cabe.
  function _autoAltoInput() {
    var inp = $('te_iaInput');
    if (!inp) return;
    inp.style.height = 'auto';
    var alto = Math.max(34, inp.scrollHeight);
    inp.style.height = alto + 'px';
  }

  function _enviar() {
    if (PENSANDO) return;
    _reiniciarSiOtroElemento();
    var inp = $('te_iaInput');
    if (!inp) return;
    var txt = (inp.value || '').trim();
    if (!txt) return;
    inp.value = '';
    _autoAltoInput();                 // vuelve a una linea al vaciarse
    _agregar('user', txt);

    PENSANDO = true;
    // Indicador VIVO (pedido del usuario 31-ago): contador de segundos para que
    // no parezca detenido — la respuesta llega en bloque y puede tardar 5-15 s.
    var esperando = _burbuja('asistente', 'Pensando… 0 s');
    var t0 = Date.now();
    var tick = setInterval(function () {
      if (esperando) esperando.textContent =
        'Pensando… ' + Math.round((Date.now() - t0) / 1000) + ' s';
    }, 1000);
    var btn = $('te_iaEnviar');
    if (btn) btn.disabled = true;

    _preguntar().then(function (d) {
      if (esperando) esperando.remove();
      _agregar('asistente', d.texto || '…');
      if (d.receta) {
        PROPUESTA = { receta: d.receta, resumen: d.resumen || [] };
        _pintarForm(PROPUESTA.resumen);
        // INSTALACIÓN EN VIVO (§12.2.5, nada guardado): el hormigón entra primero
        // y las barras se van colocando de a una, para que el usuario VEA cómo se
        // arma el muro en vez de que aparezca todo de golpe (pedido 31-ago).
        _instalarEnVivo();
      }
    }).catch(function (e) {
      if (esperando) esperando.remove();
      // El error NO entra al historial: es un problema de conexión, no parte de
      // la conversación con el modelo.
      _burbuja('asistente', '⚠ ' + ((e && e.message) || 'El asistente no respondió.'));
    }).finally(function () {
      clearInterval(tick);
      PENSANDO = false;
      if (btn) btn.disabled = false;
      _marcarBtn();
    });
  }

  // ---------------------------------------------------------------------------
  // FORMULARIO — filas {seccion}|{label,valor,origen} que manda el backend
  // ---------------------------------------------------------------------------
  var ORG_TXT = { leido: 'leído', config: 'config', asumido: 'asumido', falta: 'falta' };

  // LA FICHA VA PLEGADA (usuario 1-sep: «se pierde el espacio del texto»).
  // Ocupaba hasta el 38% del panel de forma permanente, o sea que una conversacion
  // con un formulario clavado en el medio no era ninguna de las dos cosas. Ahora es
  // UNA LINEA que se abre al clic.
  // Y esa linea no dice «ficha»: dice CUANTO ASUMIO. Es el unico dato por el que uno
  // abriria el detalle -- si asumio algo, hay que mirarlo; si no, no hay nada que
  // revisar. Un resumen que solo cuenta filas no ahorra el clic.
  function _resumenFicha(filas) {
    var datos = 0, asumidos = 0, faltan = 0;
    filas.forEach(function (r) {
      if (r.seccion) return;
      datos++;
      if (r.origen === 'asumido') asumidos++;
      else if (r.origen === 'falta') faltan++;
    });
    var p = [datos + (datos === 1 ? ' dato' : ' datos')];
    if (asumidos) p.push(asumidos + ' asumido' + (asumidos === 1 ? '' : 's'));
    if (faltan) p.push(faltan + ' sin definir');
    return 'Ficha · ' + p.join(' · ');
  }

  function _pintarForm(filas) {
    var f = $('te_iaForm');
    if (!f) return;
    if (!filas || !filas.length) { f.innerHTML = ''; _mostrarCargar(false); return; }
    var h = '<details class="te-ia-det"><summary class="te-ia-sum"></summary>'
          + '<div class="te-ia-body">';
    filas.forEach(function (r) {
      if (r.seccion) { h += '<div class="te-ia-ft"></div>'; return; }
      h += '<div class="te-ia-fila"><span class="lbl"></span>'
        + '<span class="val"></span><span class="te-ia-org"></span></div>';
    });
    h += '</div></details>';
    f.innerHTML = h;
    // textContent: el resumen lleva numeros propios, pero se escribe igual por la
    // misma puerta que el resto -- una sola regla para todo lo que pinta esta ficha.
    var sum = f.querySelector('.te-ia-sum');
    if (sum) sum.textContent = _resumenFicha(filas);
    // textContent, no innerHTML: valores y labels vienen del backend/modelo y no
    // deben poder inyectar markup.
    var fts = f.querySelectorAll('.te-ia-ft'), fi = 0;
    var rows = f.querySelectorAll('.te-ia-fila'), ri = 0;
    filas.forEach(function (r) {
      if (r.seccion) { fts[fi++].textContent = r.seccion; return; }
      var row = rows[ri++];
      row.querySelector('.lbl').textContent = r.label || '';
      row.querySelector('.val').textContent = r.valor || '';
      var org = row.querySelector('.te-ia-org');
      var o = (r.origen in ORG_TXT) ? r.origen : 'asumido';
      org.classList.add(o);
      org.textContent = ORG_TXT[o];
    });
    _mostrarCargar(true);
  }

  function _mostrarCargar(si) {
    var b = $('te_iaCargar');
    if (b) b.style.display = si ? '' : 'none';
    var c = $('te_iaCopiar');
    if (c) c.style.display = si ? '' : 'none';
  }

  // COPIAR LA RECETA — la evidencia exacta de lo que se instalo. Existe porque
  // diagnosticar una barra deforme mirando el 3D es interpretar pixeles: con el
  // JSON se lee la figura, las dims y la pose de cada componente sin adivinar.
  function _alPortapapeles(txt, aviso) {
    var ok = function () { _burbuja('asistente', aviso); };
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(ok, function () { _copiarFallback(txt, ok); });
    } else {
      _copiarFallback(txt, ok);
    }
  }

  function _copiarReceta() {
    if (!PROPUESTA || !PROPUESTA.receta) return;
    try {
      _alPortapapeles(JSON.stringify(PROPUESTA.receta, null, 2),
        'Receta copiada al portapapeles.');
    } catch (e) { /* receta no serializable: no hay nada que copiar */ }
  }

  // COPIAR EL CHAT — la conversación entera más la ficha propuesta, en texto plano.
  // Sirve para pegarla donde se pueda revisar por qué el asistente entendió mal:
  // el hilo completo dice mucho más que una captura del resultado.
  var SALTO = String.fromCharCode(10);

  function _copiarChat() {
    var l = ['=== Chat · Asistente de enfierrado ==='];
    var est = _estadoEditor() || {};
    if (est.elemento) l.push('Elemento: ' + est.elemento + (est.nombre ? ' · ' + est.nombre : ''));
    l.push('');
    if (!CHAT.length) {
      l.push('(conversación vacía)');
    } else {
      CHAT.forEach(function (m) {
        l.push('[' + (m.rol === 'user' ? 'USUARIO' : 'ASISTENTE') + '] ' + m.texto);
        l.push('');
      });
    }
    if (PROPUESTA && PROPUESTA.resumen && PROPUESTA.resumen.length) {
      l.push('--- Ficha propuesta ---');
      PROPUESTA.resumen.forEach(function (r) {
        if (r.seccion) { l.push('# ' + r.seccion); return; }
        l.push('  ' + (r.label || '') + ': ' + (r.valor || '') +
          (r.origen ? '  [' + r.origen + ']' : ''));
      });
    }
    _alPortapapeles(l.join(SALTO), 'Chat copiado al portapapeles.');
  }

  // Fallback sin permiso de portapapeles (o http): textarea + execCommand.
  function _copiarFallback(txt, ok) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      ok();
    } catch (e) {
      _burbuja('asistente', 'No pude copiarla; abre la consola del navegador y usa el JSON de ahi.');
      if (global.console) global.console.log(txt);
    }
  }

  // ---------------------------------------------------------------------------
  // CARGAR COMO BORRADOR — reabre el editor con la receta propuesta (§12.2.5),
  // por la MISMA puerta que el borrador local. No guarda nada.
  // ---------------------------------------------------------------------------
  // INSTALAR EN VIVO — abre el editor con el HORMIGÓN y ningún fierro, y después
  // agrega los componentes uno por uno (templateEditorAgregarComponente, la misma
  // puerta del clic que coloca a mano). Entre uno y otro hay una pausa corta: lo
  // que se ve es el muro armándose. Si el usuario cierra el modal a medio camino,
  // se corta sin dejar nada a medias.
  var PASO_MS = 320;
  var _instalando = false;

  function _instalarEnVivo() {
    if (!PROPUESTA || !PROPUESTA.receta) return;
    if (typeof global.templateEditorAbrir !== 'function'
      || typeof global.templateEditorAgregarComponente !== 'function') {
      _cargarBorrador(true);   // editor viejo sin la puerta: carga de una
      return;
    }
    var est = _estadoEditor() || {};
    if (est.soloVista) return;
    var comps = (PROPUESTA.receta.componentes || []).slice();
    if (!comps.length) { _cargarBorrador(true); return; }

    _abrirConReceta({ tipo: PROPUESTA.receta.tipo,
                      geometria: PROPUESTA.receta.geometria,
                      componentes: [] }, est);
    _instalando = true;
    var i = 0;
    (function siguiente() {
      if (!_instalando) return;
      var e = _estadoEditor();
      if (!e || !e.abierto) { _instalando = false; _estado(null); return; }
      if (i >= comps.length) {
        _instalando = false;
        _estado(null);
        return;
      }
      global.templateEditorAgregarComponente(comps[i]);
      i++;
      _estado('colocando ' + i + ' de ' + comps.length);
      global.setTimeout(siguiente, PASO_MS);
    })();
  }

  // Texto de estado del encabezado del chat (vuelve a su etiqueta con null).
  function _estado(txt) {
    var e = $('te_iaEstado');
    if (e) e.textContent = txt || 'muros · F1';
  }

  // Abrir el editor con una receta dada, conservando el contexto (obra/piso) y
  // sin reiniciar la conversación (es el MISMO muro).
  function _abrirConReceta(receta, est) {
    _aplicandoIA = true;
    try {
      global.templateEditorAbrir({
        elemento: 'MURO',
        nombre: est.nombre || '',
        dims: receta.geometria,
        receta: receta,
        templateId: null,
        obra: (est.obra != null) ? est.obra : null,
        ctxObra: est.ctxObra || null,
        piso: est.piso || '',
        instanciaId: (est.instanciaId != null) ? est.instanciaId : null
      });
    } finally { _aplicandoIA = false; _selloVisto = _sello(); }
  }

  // auto=true → la carga automática al recibir la receta (el usuario ve las barras
  // aparecer sin apretar nada, pedido 31-ago). auto=false → el botón, que es una
  // RE-carga: vuelve a la propuesta después de que el usuario editó a mano.
  function _cargarBorrador(auto) {
    if (!PROPUESTA || !PROPUESTA.receta) return;
    if (typeof global.templateEditorAbrir !== 'function') return;
    var est = _estadoEditor() || {};
    if (est.soloVista) {
      if (!auto) _burbuja('asistente', 'Este editor está en solo-vista: no puedo cargar la receta aquí.');
      return;
    }
    // templateId null adentro de _abrirConReceta: esta receta es NUEVA — «Guardar
    // template» crea una, no pisa la que estaba abierta (criterio del modo obra).
    _instalando = false;              // una re-carga cancela una instalación en curso
    _abrirConReceta(PROPUESTA.receta, est);
    // En auto-carga el texto de cierre ya lo puso la respuesta del asistente; este
    // mensaje es sólo para la RE-carga con el botón.
    if (!auto) {
      _agregar('asistente', 'Listo — volví a cargar mi propuesta al editor ' +
        '(pisó lo que había). Nada quedó guardado.');
    }
  }

  // ---------------------------------------------------------------------------
  // ABRIR / MINIMIZAR / REINICIO POR ELEMENTO NUEVO
  // ---------------------------------------------------------------------------
  function _saludo() {
    if (CHAT.length) return;
    _agregar('asistente', 'Hola 👋 Soy el asistente de enfierrado. Descríbeme el ' +
      'muro (dimensiones, mallas, trabas) y armo la receta: lo que no sepa te lo ' +
      'pregunto, y nada queda guardado hasta que tú lo decidas. Por ahora sé de ' +
      'muros; los recortes de plano vienen en la próxima etapa.');
  }

  function _abrir() {
    var modal = $('te_modal');
    if (!modal) return;
    _reiniciarSiOtroElemento();   // otro template abierto = conversacion nueva
    ABIERTO = true;
    modal.classList.add('te-ia-abierto');
    _marcarBtn();
    _saludo();
    _pintarMsgs();
    if (PROPUESTA) _pintarForm(PROPUESTA.resumen);
    var inp = $('te_iaInput');
    if (inp) inp.focus();
  }

  function _minimizar() {
    var modal = $('te_modal');
    if (!modal) return;
    ABIERTO = false;
    modal.classList.remove('te-ia-abierto');   // la conversación QUEDA en CHAT
    _marcarBtn();
  }

  function _reiniciar() {
    CHAT = [];
    PROPUESTA = null;
    _instalando = false;
    _estado(null);
    var box = $('te_iaMsgs'); if (box) box.innerHTML = '';
    _pintarForm(null);
    if (ABIERTO) { _saludo(); }
    _marcarBtn();
  }

  function _marcarBtn() {
    var b = $('te_btnIA');
    if (!b) return;
    b.classList.toggle('on', ABIERTO || CHAT.length > 0);
    b.textContent = (!ABIERTO && CHAT.length) ? '🤖 IA ·' : '🤖 IA';
    b.title = (!ABIERTO && CHAT.length)
      ? 'Asistente IA — hay una conversación en curso (minimizada)'
      : 'Asistente IA de enfierrado — arma la receta del muro conversando';
  }

  // MURO NUEVO = CHAT NUEVO (§12.3). Se lee el CONTADOR DE APERTURAS que estampa
  // templateEditorAbrir (`global.__teAperturas`): si cambió desde la última vez
  // que el chat lo miró, es otro elemento y la conversación se reinicia.
  //
  // Antes esto se hacía envolviendo templateEditorAbrir al cargar el script, y
  // NO FUNCIONABA: bootstrap.js pide los features en paralelo, así que este
  // archivo podía correr antes que template_editor.js y el envoltorio se
  // instalaba sobre `undefined`. El usuario abrió un template nuevo y encontró
  // el chat con toda la conversación anterior (31-ago). Un número que se
  // consulta no depende del orden de carga; un hook que se instala, sí.
  //
  // Cargar-como-borrador también reabre el editor, pero es el MISMO muro: ahí se
  // re-sella el sello sin reiniciar (ver _cargarBorrador).
  function _sello() { return global.__teAperturas || 0; }

  function _reiniciarSiOtroElemento() {
    var s = _sello();
    if (s === _selloVisto) return;
    _selloVisto = s;
    _reiniciar();
  }

  // ---------------------------------------------------------------------------
  // CABLEADO — una sola vez al cargar (los nodos del modal existen siempre).
  // ---------------------------------------------------------------------------
  function _bind() {
    var b = $('te_btnIA');
    if (!b || b._iaBound) return;
    b._iaBound = true;
    _selloVisto = _sello();
    _estado(null);
    b.addEventListener('click', function () { ABIERTO ? _minimizar() : _abrir(); });
    var min = $('te_iaMin');
    if (min) min.addEventListener('click', _minimizar);
    var env = $('te_iaEnviar');
    if (env) env.addEventListener('click', _enviar);
    var inp = $('te_iaInput');
    if (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _enviar(); }
      });
      // El campo crece con el texto (hasta el tope del CSS) y vuelve a su alto al
      // vaciarse. Se engancha a 'input' —no a keyup— para que tambien crezca al
      // PEGAR un pedido largo, que es justo cuando molestaba.
      inp.addEventListener('input', _autoAltoInput);
      _autoAltoInput();
    }
    var cargar = $('te_iaCargar');
    // OJO: sin el envoltorio, addEventListener pasa el MouseEvent como `auto`
    // (truthy) y la re-carga se quedaria muda.
    if (cargar) cargar.addEventListener('click', function () { _cargarBorrador(false); });
    var cop = $('te_iaCopiar');
    if (cop) cop.addEventListener('click', _copiarReceta);
    var copChat = $('te_iaCopiarChat');
    if (copChat) copChat.addEventListener('click', _copiarChat);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bind);
  } else {
    _bind();
  }
})(window);
