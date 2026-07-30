/* combobox.js — Componente ESTÁNDAR de filtro de texto con autocompletado.
 *
 * Reemplaza el patrón disperso de <input list=datalist> (13 variantes en el frontend),
 * que falla de formas distintas porque el navegador trata el <input list> como campo
 * autocompletable y a veces lo confunde con campo de CLAVE (el bug del filtro de Eje del
 * Bar Manager: pedía contraseña / se comportaba como password). Aquí NO se usa <datalist>:
 * el desplegable de sugerencias es una lista propia de <div> que controlamos nosotros.
 *
 * Ventajas sobre el datalist nativo (los 4 problemas que teníamos):
 *  - Filtrado por "CONTIENE" (no solo por prefijo), controlado por nosotros.
 *  - El click en una sugerencia entrega el ITEM completo {id, label,...} → se acaba
 *    "adivinar el id desde el texto".
 *  - Puede VALIDAR que lo escrito exista (marca el campo si no corresponde a nada).
 *  - No dispara el gestor de contraseñas de Chrome (no hay list=, ni type que lo gatille).
 *
 * API:
 *   const cb = Combobox.crear(inputEl, {
 *     items:        () => [{id, label, sub?}]  // función que devuelve las opciones actuales
 *     onSelect:     (item|null) => {}          // al elegir (item) o limpiar/no-match (null)
 *     textoLibre:   false,                     // true = el texto escrito ES válido aunque no matchee (eje/ciclo)
 *     getLabel:     it => it.label,            // texto que se muestra y con el que se filtra
 *     getSub:       it => it.sub,              // (opcional) 2ª línea/columna (ej: "código (parciales)")
 *     placeholder:  '…',
 *     minChars:     0,                         // 0 = muestra todo al enfocar
 *   });
 *   cb.setValor(item)   // fija el input a un item (sin disparar onSelect)
 *   cb.getItem()        // item elegido actualmente (o null)
 *   cb.limpiar()
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function crear(input, opts) {
    opts = opts || {};
    var getLabel = opts.getLabel || function (it) { return it && (it.label != null ? it.label : it.id); };
    var getSub = opts.getSub || function (it) { return it && it.sub; };
    var textoLibre = !!opts.textoLibre;
    var minChars = opts.minChars || 0;

    // Blindaje anti gestor-de-contraseñas de Chrome (la causa del "pide clave").
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('data-lpignore', 'true');       // LastPass
    input.setAttribute('data-form-type', 'other');     // Dashlane/otros
    input.setAttribute('data-1p-ignore', 'true');      // 1Password
    input.removeAttribute('list');                     // sin datalist nativo
    input.removeAttribute('readonly');                 // readonly rompía oninput (bug histórico)
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (!input.getAttribute('name')) input.setAttribute('name', 'cb-' + Math.random().toString(36).slice(2));

    // Contenedor posicionado + panel de sugerencias propio.
    var wrap = document.createElement('div');
    wrap.className = 'cb-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var panel = document.createElement('div');
    panel.className = 'cb-panel';
    panel.style.display = 'none';
    wrap.appendChild(panel);

    var itemSel = null;   // item elegido
    var activo = -1;       // índice resaltado por teclado
    var render = [];       // items visibles actualmente

    function filtrar(txt) {
      var q = (txt || '').trim().toLowerCase();
      var all = (opts.items ? opts.items() : []) || [];
      if (q.length < minChars) return all.slice(0, 50);
      if (!q) return all.slice(0, 50);
      // "CONTIENE" (no solo prefijo); prioriza los que EMPIEZAN con la query.
      var pre = [], mid = [];
      all.forEach(function (it) {
        var lab = String(getLabel(it) || '').toLowerCase();
        var i = lab.indexOf(q);
        if (i === 0) pre.push(it); else if (i > 0) mid.push(it);
      });
      return pre.concat(mid).slice(0, 50);
    }

    function pintar() {
      if (!render.length) {
        panel.innerHTML = '<div class="cb-empty">Sin coincidencias</div>';
      } else {
        panel.innerHTML = render.map(function (it, i) {
          var sub = getSub(it);
          return '<div class="cb-opt' + (i === activo ? ' on' : '') + '" data-i="' + i + '">' +
            '<span class="cb-lab">' + esc(getLabel(it)) + '</span>' +
            (sub ? '<span class="cb-sub">' + esc(sub) + '</span>' : '') + '</div>';
        }).join('');
      }
      panel.style.display = 'block';
    }

    function abrir() { render = filtrar(input.value); activo = -1; pintar(); }
    function cerrar() { panel.style.display = 'none'; activo = -1; }

    function elegir(it) {
      itemSel = it;
      input.value = it ? String(getLabel(it)) : '';
      input.classList.remove('cb-invalido');
      cerrar();
      if (opts.onSelect) opts.onSelect(it);
    }

    // Resuelve el texto actual a un item (exacto → único que contiene). En texto libre,
    // si no matchea, igual es válido (el valor es el texto). Si no, marca inválido.
    function resolverAlSalir() {
      var q = (input.value || '').trim().toLowerCase();
      if (!q) { itemSel = null; input.classList.remove('cb-invalido'); if (opts.onSelect) opts.onSelect(null); return; }
      var all = (opts.items ? opts.items() : []) || [];
      var exact = all.find(function (it) { return String(getLabel(it)).toLowerCase() === q; });
      var cand = exact || (function () {
        var m = all.filter(function (it) { return String(getLabel(it)).toLowerCase().indexOf(q) >= 0; });
        return m.length === 1 ? m[0] : null;
      })();
      if (cand) { elegir(cand); return; }
      // No resolvió a un item.
      itemSel = null;
      if (textoLibre) { input.classList.remove('cb-invalido'); if (opts.onSelect) opts.onSelect(null); }
      else { input.classList.add('cb-invalido'); if (opts.onSelect) opts.onSelect(null); }
    }

    input.addEventListener('focus', abrir);
    input.addEventListener('input', function () { itemSel = null; abrir(); });
    input.addEventListener('keydown', function (e) {
      if (panel.style.display === 'none' && (e.key === 'ArrowDown')) { abrir(); return; }
      if (e.key === 'ArrowDown') { activo = Math.min(activo + 1, render.length - 1); pintar(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { activo = Math.max(activo - 1, 0); pintar(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (activo >= 0 && render[activo]) { elegir(render[activo]); e.preventDefault(); } else { resolverAlSalir(); cerrar(); } }
      else if (e.key === 'Escape') { cerrar(); }
    });
    // Click en una sugerencia (mousedown para ganarle al blur).
    panel.addEventListener('mousedown', function (e) {
      var opt = e.target.closest('.cb-opt'); if (!opt) return;
      e.preventDefault();
      elegir(render[+opt.getAttribute('data-i')]);
    });
    input.addEventListener('blur', function () { setTimeout(function () { cerrar(); resolverAlSalir(); }, 120); });
    // Cerrar al hacer click fuera.
    document.addEventListener('mousedown', function (e) { if (!wrap.contains(e.target)) cerrar(); });

    return {
      setValor: function (it) { itemSel = it; input.value = it ? String(getLabel(it)) : ''; input.classList.remove('cb-invalido'); },
      getItem: function () { return itemSel; },
      getTexto: function () { return input.value; },
      limpiar: function () { itemSel = null; input.value = ''; input.classList.remove('cb-invalido'); cerrar(); },
      refrescar: function () { if (panel.style.display !== 'none') abrir(); }
    };
  }

  window.Combobox = { crear: crear, esc: esc };
})();
