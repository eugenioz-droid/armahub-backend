/* buscador_obra.js — COMPONENTE reutilizable del buscador de obra (texto + datalist).
 *
 * Es EL MISMO buscador de obra que usa el Bar Manager (input + <datalist> + <select> oculto
 * que conserva el id real), extraído a componente para reutilizarlo idéntico en el Bar Manager
 * y en el creador de barras. Misma lógica de resolución texto→id (exacto / prefijo único /
 * fallback por el select oculto).
 *
 * Uso:
 *   var b = BuscadorObra.crear({
 *     inputId:    'bmProyectoSearchInput',  // <input list=...>
 *     datalistId: 'bmProyectosDatalist',    // <datalist> que se puebla con las obras
 *     selectId:   'proyecto',               // <select> oculto que guarda el id elegido
 *     onElegir:   function(idProyecto){ ... } // se llama cuando el id RESUELTO cambia
 *   });
 *   b.setProyectos([{id, nombre}, ...]);   // poblar/actualizar la lista de obras
 *   b.getId();                              // id de la obra elegida ('' si ninguna)
 *   b.limpiar();
 */
(function () {
  'use strict';

  function crear(opts) {
    opts = opts || {};
    var input = document.getElementById(opts.inputId);
    var dl = document.getElementById(opts.datalistId);
    var sel = opts.selectId ? document.getElementById(opts.selectId) : null;
    var cache = [];   // [{id, nombre}] de esta instancia (no global)

    // Blindaje anti gestor-de-contraseñas (por si el input del HTML no lo trae).
    if (input) {
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('data-lpignore', 'true');
      input.setAttribute('data-form-type', 'other');
      input.removeAttribute('readonly');
      if (opts.datalistId) input.setAttribute('list', opts.datalistId);
    }

    // Puebla el <datalist> con las obras (escapando comillas). Igual que _fillProyectosDatalist.
    function setProyectos(proyectos) {
      cache = proyectos || [];
      if (!dl) return;
      dl.innerHTML = cache.map(function (p) {
        var nombre = (p.nombre || p.id);
        return '<option value="' + String(nombre).replace(/"/g, '&quot;') + '"></option>';
      }).join('');
    }

    // Resuelve un texto (minúsculas) a id de obra: exacto → prefijo ÚNICO → fallback select.
    // MISMA lógica que _resolverProyectoId del Bar Manager.
    function _resolver(txtLow) {
      if (!txtLow) return '';
      var exact = cache.find(function (p) { return String(p.nombre || p.id).toLowerCase() === txtLow; });
      if (exact) return String(exact.id);
      var matches = cache.filter(function (p) { return String(p.nombre || p.id).toLowerCase().indexOf(txtLow) === 0; });
      if (matches.length === 1) return String(matches[0].id);
      if (sel && sel.options) {
        for (var i = 0; i < sel.options.length; i++) {
          var o = sel.options[i];
          if (o.value && o.textContent.trim().toLowerCase() === txtLow) return o.value;
        }
      }
      return '';
    }

    // El usuario escribió/eligió: resuelve y, si el id cambió, actualiza el select oculto y
    // avisa. Idempotente (si el id no cambió, no dispara). Igual que onProyectoInput.
    function _onInput() {
      if (!input) return;
      var txtLow = (input.value || '').trim().toLowerCase();
      var id = _resolver(txtLow);
      var actual = sel ? sel.value : '';
      if (id === actual) return;
      if (sel) sel.value = id;
      if (opts.onElegir) opts.onElegir(id);
    }

    if (input) {
      input.addEventListener('input', _onInput);
      input.addEventListener('change', _onInput);
      input.addEventListener('blur', _onInput);
    }

    return {
      setProyectos: setProyectos,
      getId: function () { return sel ? sel.value : ''; },
      limpiar: function () { if (input) input.value = ''; if (sel) sel.value = ''; },
      resolver: _onInput
    };
  }

  window.BuscadorObra = { crear: crear };
})();
