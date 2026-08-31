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
// la pierde; ABRIR OTRO ELEMENTO la reinicia (muro nuevo = chat nuevo) — eso lo
// detecta el envoltorio sobre templateEditorAbrir de abajo. F5 la pierde (F1).
//
// «Cargar como borrador» reabre el editor con la receta propuesta por LA MISMA
// puerta que usa el borrador local (templateEditorAbrir), conservando contexto
// de obra/piso. No guarda nada (§12.2.5).
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
          var msg = (d && d.detail) || ('El asistente no respondió (' + r.status + ').');
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

  function _enviar() {
    if (PENSANDO) return;
    var inp = $('te_iaInput');
    if (!inp) return;
    var txt = (inp.value || '').trim();
    if (!txt) return;
    inp.value = '';
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

  function _pintarForm(filas) {
    var f = $('te_iaForm');
    if (!f) return;
    if (!filas || !filas.length) { f.innerHTML = ''; _mostrarCargar(false); return; }
    var h = '';
    filas.forEach(function (r) {
      if (r.seccion) { h += '<div class="te-ia-ft"></div>'; return; }
      h += '<div class="te-ia-fila"><span class="lbl"></span>'
        + '<span class="val"></span><span class="te-ia-org"></span></div>';
    });
    f.innerHTML = h;
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
  }

  // ---------------------------------------------------------------------------
  // CARGAR COMO BORRADOR — reabre el editor con la receta propuesta (§12.2.5),
  // por la MISMA puerta que el borrador local. No guarda nada.
  // ---------------------------------------------------------------------------
  function _cargarBorrador() {
    if (!PROPUESTA || !PROPUESTA.receta) return;
    if (typeof global.templateEditorAbrir !== 'function') return;
    var est = _estadoEditor() || {};
    if (est.soloVista) {
      _burbuja('asistente', 'Este editor está en solo-vista: no puedo cargar la receta aquí.');
      return;
    }
    _aplicandoIA = true;      // que el envoltorio NO reinicie el chat (mismo muro)
    try {
      global.templateEditorAbrir({
        elemento: 'MURO',
        nombre: est.nombre || '',
        dims: PROPUESTA.receta.geometria,
        receta: PROPUESTA.receta,
        // templateId null: esta receta es NUEVA — «Guardar template» crea una,
        // no pisa la que estaba abierta (mismo criterio que el modo obra).
        templateId: null,
        obra: (est.obra != null) ? est.obra : null,
        ctxObra: est.ctxObra || null,
        piso: est.piso || '',
        instanciaId: (est.instanciaId != null) ? est.instanciaId : null
      });
    } finally { _aplicandoIA = false; }
    _agregar('asistente', 'Listo — cargué la receta al editor como borrador. ' +
      'Revísala en el 3D; nada quedó guardado. Si quieres ajustar algo, dime.');
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

  // MURO NUEVO = CHAT NUEVO (§12.3): se envuelve templateEditorAbrir para
  // detectar cada apertura. Cargar-como-borrador también pasa por aquí, pero es
  // el MISMO muro (flag _aplicandoIA) y la conversación se conserva. Este script
  // carga DESPUÉS de template_editor.js (bootstrap.js), así que el original ya
  // existe; si algún día no, el envoltorio simplemente no se instala y lo único
  // que se pierde es el reinicio automático.
  function _envolverAbrir() {
    var orig = global.templateEditorAbrir;
    if (typeof orig !== 'function' || orig._iaWrapped) return;
    var wrapper = function (cfg) {
      if (!_aplicandoIA) _reiniciar();
      return orig.apply(this, arguments);
    };
    wrapper._iaWrapped = true;
    global.templateEditorAbrir = wrapper;
  }

  // ---------------------------------------------------------------------------
  // CABLEADO — una sola vez al cargar (los nodos del modal existen siempre).
  // ---------------------------------------------------------------------------
  function _bind() {
    var b = $('te_btnIA');
    if (!b || b._iaBound) return;
    b._iaBound = true;
    _envolverAbrir();
    var est = $('te_iaEstado');
    if (est) est.textContent = 'muros · F1';
    b.addEventListener('click', function () { ABIERTO ? _minimizar() : _abrir(); });
    var min = $('te_iaMin');
    if (min) min.addEventListener('click', _minimizar);
    var env = $('te_iaEnviar');
    if (env) env.addEventListener('click', _enviar);
    var inp = $('te_iaInput');
    if (inp) inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _enviar(); }
    });
    var cargar = $('te_iaCargar');
    if (cargar) cargar.addEventListener('click', _cargarBorrador);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bind);
  } else {
    _bind();
  }
})(window);
