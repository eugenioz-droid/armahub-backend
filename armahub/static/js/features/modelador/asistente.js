// =============================================================================
// asistente.js — ASISTENTE IA DE ENFIERRADO (SPECS_ARMAHUB.md §12).
//
// ETAPA 1 · MAQUETA VISUAL SIN LÓGICA (método del usuario: primero se ve, después
// se conecta). Este archivo cablea el botón 🤖 IA del titlebar del Template Editor
// y el panel de chat que REEMPLAZA al panel de componentes (#te_side) mientras
// está abierto — el 3D queda siempre visible. En la Etapa 2, _responder() deja de
// ser una respuesta fija y pasa a llamar POST /api/v1/asistente/chat (backend →
// API Anthropic), y el formulario se pinta desde la receta REAL del editor.
//
// PERSISTENCIA (decisión §12.3): la conversación vive en memoria de sesión
// (variable de módulo). Minimizar NO la pierde; recargar la página o abrir otro
// muro (etapa 2) la reinicia. No se guarda en BD.
//
// El markup y el CSS viven en template_editor_modal.html (todo scopeado bajo
// #te_backdrop, pintado con variables --te-* para seguir a los 3 temas).
// =============================================================================
(function (global) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // Conversación de la sesión: [{rol:'user'|'bot', texto}]. Muere con la página.
  var CHAT = [];
  var ABIERTO = false;

  // ---------------------------------------------------------------------------
  // FORMULARIO DE MUESTRA — Etapa 1. Enseña el mapa que el asistente irá
  // llenando: los campos del hormigón + las barras del muro, cada uno con su chip
  // de ORIGEN (§12.2.4). En Etapa 2 esto se pinta desde ST.receta viva.
  // ---------------------------------------------------------------------------
  var FORM_DEMO = [
    { t: 'Hormigón (muro)' },
    { l: 'Largo × Alto', v: '600 × 320 cm', o: 'leido' },
    { l: 'Espesor', v: '20 cm', o: 'leido' },
    { l: 'Recubrimiento', v: '3 cm', o: 'config' },
    { t: 'Barras' },
    { l: 'Malla vertical', v: 'φ10 @ 20', o: 'leido' },
    { l: 'Malla horizontal', v: 'φ8 @ 25', o: 'leido' },
    { l: 'Trabas', v: 'φ8 · 40 × 40', o: 'asumido' },
    { l: 'Ganchos', v: '', o: 'falta' }
  ];
  var ORG_TXT = { leido: 'leído', config: 'config', asumido: 'asumido', falta: 'falta' };

  function _pintarForm() {
    var f = $('te_iaForm');
    if (!f) return;
    var h = '';
    FORM_DEMO.forEach(function (r) {
      if (r.t) { h += '<div class="te-ia-ft">' + r.t + '</div>'; return; }
      h += '<div class="te-ia-fila"><span class="lbl">' + r.l + '</span>'
        + '<span class="val' + (r.v ? '' : ' vacio') + '">' + (r.v || 'sin dato — pregunto abajo') + '</span>'
        + '<span class="te-ia-org ' + r.o + '">' + ORG_TXT[r.o] + '</span></div>';
    });
    f.innerHTML = h;
    var cargar = $('te_iaCargar');
    if (cargar) cargar.style.display = '';
  }

  // ---------------------------------------------------------------------------
  // MENSAJES
  // ---------------------------------------------------------------------------
  function _pintarMsgs() {
    var box = $('te_iaMsgs');
    if (!box) return;
    box.innerHTML = '';
    CHAT.forEach(function (m) {
      var d = document.createElement('div');
      d.className = 'te-ia-msg ' + (m.rol === 'user' ? 'user' : 'bot');
      d.textContent = m.texto;
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  }

  function _agregar(rol, texto) {
    CHAT.push({ rol: rol, texto: texto });
    _pintarMsgs();
  }

  // Etapa 1: respuesta FIJA de maqueta. Etapa 2: POST /api/v1/asistente/chat con
  // el historial completo + la receta ACTUAL del editor (§12.2.6), icono de
  // cargando ~5-15 s y respuesta en bloque (opción A, decisión 14).
  function _responder() {
    _agregar('bot', 'Soy una maqueta todavía (Etapa 1): en la Etapa 2 me conecto y ' +
      'te contesto de verdad, leyendo tu config y llenando el formulario de arriba.');
  }

  function _enviar() {
    var inp = $('te_iaInput');
    if (!inp) return;
    var txt = (inp.value || '').trim();
    if (!txt) return;
    inp.value = '';
    _agregar('user', txt);
    _responder();
  }

  // ---------------------------------------------------------------------------
  // ABRIR / MINIMIZAR — el estado va como clase en #te_modal (igual que los
  // temas te-tema-*): el CSS del modal hace el intercambio con #te_side.
  // ---------------------------------------------------------------------------
  function _saludo() {
    if (CHAT.length) return;
    _agregar('bot', 'Hola 👋 Soy el asistente de enfierrado. Descríbeme el muro ' +
      '(o pégame un recorte del plano, eso viene en la etapa de imágenes) y voy ' +
      'armando la receta en el panel de abajo. Lo que no sepa, te lo pregunto.');
    _agregar('user', 'Muro de 6 m por 3,2 m, espesor 20, doble malla φ10@20 ' +
      'vertical y φ8@25 horizontal. Trabas estándar.');
    _agregar('bot', 'Anotado — mira el formulario: largo, alto, espesor y las dos ' +
      'mallas quedaron leídos de tu texto; el recubrimiento lo saqué de la config ' +
      '(3 cm) y las trabas las asumí φ8 en grilla 40×40 por «estándar». ' +
      'Me falta UNA cosa: ¿las mallas llevan gancho en los extremos?');
    _pintarForm();
  }

  function _abrir() {
    var modal = $('te_modal');
    if (!modal) return;
    ABIERTO = true;
    modal.classList.add('te-ia-abierto');
    _marcarBtn();
    _saludo();
    _pintarMsgs();
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

  function _marcarBtn() {
    var b = $('te_btnIA');
    if (!b) return;
    b.classList.toggle('on', ABIERTO || CHAT.length > 0);
    b.textContent = (!ABIERTO && CHAT.length) ? '🤖 IA ·' : '🤖 IA';
    b.title = (!ABIERTO && CHAT.length)
      ? 'Asistente IA — hay una conversación en curso (minimizada)'
      : 'Asistente IA de enfierrado — arma la receta conversando (Etapa 1: maqueta)';
  }

  // ---------------------------------------------------------------------------
  // CABLEADO — los nodos existen siempre (el modal viene incluido en app.html),
  // así que se amarra una sola vez al cargar el script, con guarda por si el
  // loader corriera dos veces (mismo criterio que m._teSoloVistaBound del TE).
  // ---------------------------------------------------------------------------
  function _bind() {
    var b = $('te_btnIA');
    if (!b || b._iaBound) return;
    b._iaBound = true;
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
    if (cargar) cargar.addEventListener('click', function () {
      _agregar('bot', 'En la Etapa 2 este botón carga la receta propuesta como ' +
        'elemento en edición (sin guardar nada).');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bind);
  } else {
    _bind();
  }
})(window);
