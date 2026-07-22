// ArmaHub — Bar Manager: edición de barras (5M.3)
// Modo edición con candado (toggle UI, no persiste). Campos simples editables
// (diam/cant_total/largo_total); tipología/geometría no aquí. Permisos y validación
// en el backend (PATCH /barras/{id}). Guardar-al-cerrar el candado. Panel de
// ediciones recientes de la obra al final.

(function(global) {
  // Estado del modo edición (solo UI). _cambios: id_barra -> {campo: valorNuevo}.
  var _modoEdicion = false;
  var _cambios = {};

  global.bmEnModoEdicion = function() { return _modoEdicion; };
  global.bmHayCambios = function() { return Object.keys(_cambios).length > 0; };
  // ¿Hay cambios sin guardar en la sesión de edición actual? Lo consulta la
  // navegación (cambio de sección) y el aviso de cerrar navegador (5M.9).
  global.bmHayCambiosSinGuardar = function() {
    return _modoEdicion && Object.keys(_cambios).length > 0;
  };

  // Reset del modo edición (al cambiar de obra). Descarta cambios sin guardar.
  global.bmResetModoEdicion = function() {
    _modoEdicion = false;
    _cambios = {};
    _actualizarBotonEdicion();
  };

  // Catálogo de figuras cargado en memoria (5M.4): código → {parciales, angulos, radio}.
  // Permite validar la geometría AL EDITAR (inmediato), no solo al guardar.
  var _figurasCargadas = false;
  var _catFiguras = {};
  async function _cargarDatalistFiguras() {
    if (_figurasCargadas) return;
    var dl = document.getElementById('bmFigurasDatalist');
    var data = await apiGet('/figuras-catalogo');
    var figs = (data && data.figuras) || [];
    _catFiguras = {};
    figs.forEach(function(f) { _catFiguras[f.codigo] = f; });
    if (dl) {
      dl.innerHTML = figs.map(function(f) {
        return '<option value="' + f.codigo + '">' + f.codigo + ' (' + (f.parciales || []).join('') + ')</option>';
      }).join('');
    }
    _figurasCargadas = true;
  }

  // Un valor cuenta como "presente" solo si es distinto de 0 y no vacío (mismo
  // criterio que el backend: los lados no usados vienen en 0 = no existen).
  function _valReal(v) {
    if (v === null || v === undefined || v === '') return false;
    var n = parseFloat(v);
    return !isNaN(n) && n !== 0;
  }

  // Valida en el navegador la geometría de una barra contra el catálogo y resalta
  // en ROJO al instante los lados/ángulos/radio que sobran o faltan (5M.4).
  // Lee los valores EFECTIVOS de los inputs de esa fila.
  function _validarFilaLocal(barraId) {
    // Figura efectiva: input de figura o (si no editada) no la tenemos aquí → skip.
    var figInput = document.getElementById('bmcell-' + barraId + '-figura');
    if (!figInput) return;
    var figura = (figInput.value || '').trim();
    // Slots (dim_a..i, ang1..4, radio) a evaluar.
    var slots = ['dim_a','dim_b','dim_c','dim_d','dim_e','dim_f','dim_g','dim_h','dim_i',
                 'ang1','ang2','ang3','ang4','radio'];
    // Limpiar resaltados previos de esta fila.
    slots.forEach(function(s) {
      var el = document.getElementById('bmcell-' + barraId + '-' + s);
      if (el) { el.style.border = ''; el.style.background = el.value !== '' && _cambioTocado(barraId, s) ? '#fff3cd' : ''; el.title = ''; }
    });
    var fig = _catFiguras[figura];
    if (!fig) return;   // figura desconocida → el backend la rechazará al guardar
    var usados = {};
    (fig.parciales || []).forEach(function(l) { usados['dim_' + l.toLowerCase()] = true; });
    var nAng = (fig.angulos || []).length;
    // Dims
    ['a','b','c','d','e','f','g','h','i'].forEach(function(l) {
      var col = 'dim_' + l;
      var el = document.getElementById('bmcell-' + barraId + '-' + col);
      if (!el) return;
      var tiene = _valReal(el.value);
      if (usados[col] && !tiene) _marcarRojo(el, 'falta');
      else if (!usados[col] && tiene) _marcarRojo(el, 'sobra');
    });
    // Ángulos
    [1,2,3,4].forEach(function(i) {
      var el = document.getElementById('bmcell-' + barraId + '-ang' + i);
      if (!el) return;
      var usa = i <= nAng;
      var tiene = _valReal(el.value);
      if (usa && !tiene) _marcarRojo(el, 'falta');
      else if (!usa && tiene) _marcarRojo(el, 'sobra');
    });
    // Radio
    var elR = document.getElementById('bmcell-' + barraId + '-radio');
    if (elR) {
      var tieneR = _valReal(elR.value);
      if (fig.radio && !tieneR) _marcarRojo(elR, 'falta');
      else if (!fig.radio && tieneR) _marcarRojo(elR, 'sobra');
    }
  }

  function _marcarRojo(el, tipo) {
    el.style.background = '#ffcdd2';
    el.style.border = '2px solid #c62828';
    el.title = (tipo === 'sobra')
      ? 'SOBRA para esta figura — déjalo vacío o en 0'
      : 'FALTA para esta figura — complétalo';
  }

  function _cambioTocado(barraId, campo) {
    return _cambios[barraId] && (campo in _cambios[barraId]);
  }

  // Valida TODAS las filas visibles (5M.4): al entrar en modo edición o tras
  // re-render, resalta en rojo las barras que ya vienen incoherentes de origen.
  global.bmValidarTodasLasFilas = function() {
    if (!_modoEdicion) return;
    var inputs = document.querySelectorAll('input[data-campo="figura"]');
    var vistos = {};
    inputs.forEach(function(el) {
      var id = el.getAttribute('data-barra-id');
      if (id && !vistos[id]) { vistos[id] = true; _validarFilaLocal(id); }
    });
  };

  // ---- Botón GUARDAR explícito (5M.4) ----
  global.guardarCambiosBarras = async function() {
    if (Object.keys(_cambios).length === 0) {
      if (typeof showToast === 'function') showToast('No hay cambios que guardar', 'info');
      return;
    }
    await _guardarCambios();
    _actualizarBotonEdicion();
  };

  // ---- Botón DESCARTAR (5M.9) ----
  // Descarta SOLO los cambios de esta sesión de edición (los hechos desde que se
  // abrió el candado). No sale del modo edición. La memoria de las barras nunca
  // se tocó, así que un re-render limpio restituye los valores originales.
  global.descartarCambiosBarras = function() {
    var n = Object.keys(_cambios).length;
    if (n === 0) {
      if (typeof showToast === 'function') showToast('No hay cambios que descartar', 'info');
      return;
    }
    if (!confirm('¿Descartar ' + n + ' cambio(s) sin guardar de esta sesión?\n\nLas barras vuelven a sus valores originales. Esto no se puede deshacer.')) return;
    _cambios = {};
    // Re-render de la vista activa: los inputs recuperan el valor original (la
    // memoria no cambió) y se limpian los resaltados amarillo/rojo.
    if (typeof bmReRenderVistaActual === 'function') bmReRenderVistaActual();
    else if (typeof reRenderDetallesAbiertos === 'function') reRenderDetallesAbiertos();
    _actualizarBotonEdicion();
    if (typeof showToast === 'function') showToast('Cambios descartados', 'success');
  };

  // ---- Toggle candado ----
  global.toggleModoEdicion = async function() {
    if (_modoEdicion) {
      // Cerrando el candado = SALIR del modo edición. Si hay cambios sin guardar,
      // preguntar (guardar / descartar / cancelar).
      if (Object.keys(_cambios).length > 0) {
        var resp = confirm('Tienes cambios sin guardar.\n\nAceptar = GUARDAR y salir.\nCancelar = seguir editando (no sale).');
        if (!resp) return; // seguir en modo edición
        var ok = await _guardarCambios();
        if (!ok) return;   // hubo errores/geometría inválida: seguir para corregir
      }
      _modoEdicion = false;
    } else {
      // Abriendo: warning explícito.
      if (!confirm('Vas a ACTIVAR el modo edición de barras.\n\nPodrás modificar diámetro, cantidad y la geometría (figura, lados A–I, ángulos, radio). El largo se calcula solo de los lados. La figura se valida contra el catálogo: NO podrás guardar una barra con lados/ángulos que sobran o faltan (quedan en ROJO para corregir).\n\nUsa el botón "💾 Guardar cambios". Los cambios quedan auditados. ¿Continuar?')) return;
      _modoEdicion = true;
      _cambios = {};
      await _cargarDatalistFiguras();   // 5M.4: figuras del catálogo para el input
    }
    _actualizarBotonEdicion();
    // Re-render de la vista ACTIVA (plana o agrupada) para reflejar inputs /
    // solo-lectura. bmReRenderVistaActual bifurca según _modoVistaPlana (5M.9);
    // así el candado también cambia la grilla plana, no solo los desplegables.
    if (typeof bmReRenderVistaActual === 'function') bmReRenderVistaActual();
    else if (typeof reRenderDetallesAbiertos === 'function') reRenderDetallesAbiertos();
    // Validar filas visibles (resalta las incoherentes de origen).
    if (_modoEdicion) setTimeout(function() { global.bmValidarTodasLasFilas(); }, 50);
  };

  function _actualizarBotonEdicion() {
    var btn = document.getElementById('btnEdicionBarras');
    var btnGuardar = document.getElementById('btnGuardarBarras');
    var btnDescartar = document.getElementById('btnDescartarBarras');
    var status = document.getElementById('edicionStatus');
    var nCambios = Object.keys(_cambios).length;
    if (btn) {
      if (_modoEdicion) {
        btn.textContent = '🔓 Salir de edición';
        btn.style.background = '#fff3e0';
        btn.style.borderColor = '#e65100';
        btn.style.color = '#e65100';
        if (status) status.textContent = nCambios > 0 ? (nCambios + ' barra(s) con cambios sin guardar') : 'Modo edición activo — edita las celdas.';
      } else {
        btn.textContent = '🔒 Edición bloqueada';
        btn.style.background = '#eee';
        btn.style.borderColor = '#ccc';
        btn.style.color = '#333';
        if (status) status.textContent = '';
      }
    }
    if (btnGuardar) {
      btnGuardar.style.display = (_modoEdicion && nCambios > 0) ? '' : 'none';
      btnGuardar.textContent = '💾 Guardar ' + (nCambios > 0 ? ('(' + nCambios + ')') : 'cambios');
    }
    if (btnDescartar) {
      btnDescartar.style.display = (_modoEdicion && nCambios > 0) ? '' : 'none';
    }
  }

  // ---- Registro de un cambio en un input (onchange desde el render) ----
  global.bmRegistrarCambio = function(el) {
    var id = el.getAttribute('data-barra-id');
    var campo = el.getAttribute('data-campo');
    var val = el.value.trim();
    if (!id || !campo) return;
    _cambios[id] = _cambios[id] || {};
    if (campo === 'figura') {
      // Texto (no parseFloat). Vacío = figura sin definir (se envía null).
      _cambios[id][campo] = (val === '') ? null : val;
    } else if (val === '') {
      // Vaciar un dim/ángulo = eliminar ese lado. Enviar null EXPLÍCITO (no omitir)
      // para que el backend lo borre — clave para quitar el lado que sobra (5M.4).
      _cambios[id][campo] = null;
    } else {
      _cambios[id][campo] = parseFloat(val);
    }
    // Marcar celda modificada (amarillo).
    el.style.background = '#fff3cd';
    // 5M.4: revalidar la fila al instante (resalta en rojo lo que sobra/falta).
    _validarFilaLocal(id);
    _actualizarBotonEdicion();
  };

  // Resalta en ROJO los slots (dim/lados) que sobran o faltan de una barra según
  // el detalle del 409 del backend. El usuario los corrige manualmente (5M.4).
  function _resaltarSlots(barraId, slots, tipo) {
    (slots || []).forEach(function(col) {
      var el = document.getElementById('bmcell-' + barraId + '-' + col);
      if (el) {
        el.style.background = '#ffcdd2';         // rojo
        el.style.border = '2px solid #c62828';
        el.title = (tipo === 'sobra') ? 'Este lado SOBRA para la figura elegida — bórralo (deja vacío)' : 'Este lado FALTA para la figura elegida — complétalo';
      }
    });
  }

  // ---- Guardar todos los cambios (PATCH por barra) ----
  // Regla 5M.4: NO se guarda una barra con geometría incoherente. Las buenas se
  // guardan; las malas quedan resaltadas y con sus cambios intactos para corregir.
  async function _guardarCambios() {
    var ids = Object.keys(_cambios);
    if (ids.length === 0) return true;
    var okCount = 0;
    var fallidas = [];   // ids que no pasaron validación (quedan pendientes)
    var otroError = '';
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var res = await fetch(apiUrl('/barras/' + encodeURIComponent(id)), {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(_cambios[id])
      });
      if (res.status === 401) { logout(); return false; }
      var data = await res.json();
      if (res.ok && data && data.ok) {
        okCount++;
        delete _cambios[id];   // guardada: quitar de pendientes
        // Optimistic update (5M.9): actualizar la barra en memoria con lo que devolvió
        // el backend (peso/largo recalculados), sin re-pedir toda la lista.
        if (data.barra && typeof bmActualizarBarraEnMemoria === 'function') {
          bmActualizarBarraEnMemoria(data.barra);
        }
      } else if (res.status === 409 && data && data.detail && data.detail.geometria_invalida) {
        // Geometría incoherente: resaltar slots, dejar cambios para corregir.
        fallidas.push(id);
        _resaltarSlots(id, data.detail.slots_sobran, 'sobra');
        _resaltarSlots(id, data.detail.slots_faltan, 'falta');
      } else {
        fallidas.push(id);
        if (!otroError) otroError = (data && data.detail) ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : 'error';
      }
    }
    if (fallidas.length > 0) {
      // Hay barras con problemas: NO re-renderizar (perdería el resaltado rojo).
      // Solo actualizar el panel de ediciones si algo se guardó.
      if (okCount > 0 && typeof cargarEdicionesRecientes === 'function') cargarEdicionesRecientes();
      var msg = okCount + ' guardada(s). ' + fallidas.length + ' con problema: corrige lo marcado en ROJO (sobra/falta) antes de guardar.' + (otroError ? (' Otro: ' + otroError) : '');
      if (typeof showToast === 'function') showToast(msg, 'error');
      _actualizarBotonEdicion();
      return false;   // deja el modo edición abierto para corregir
    }
    // Todo OK: optimistic update — re-render local (sin re-pedir la lista), el panel
    // de ediciones y el botón. La memoria ya se actualizó con la barra del backend.
    if (okCount > 0) {
      if (typeof bmReRenderVistaActual === 'function') bmReRenderVistaActual();
      if (typeof cargarEdicionesRecientes === 'function') cargarEdicionesRecientes();
    }
    if (typeof showToast === 'function') showToast(okCount + ' barra(s) actualizada(s)', 'success');
    _actualizarBotonEdicion();
    return true;
  }

  // ---- Panel de ediciones recientes (obra actual) ----
  global.cargarEdicionesRecientes = async function() {
    var card = document.getElementById('bmEdicionesCard');
    var cont = document.getElementById('bmEdicionesLista');
    if (!card || !cont) return;
    var proy = (document.getElementById('proyecto') || {}).value;
    if (!proy) { card.style.display = 'none'; return; }
    var data = await apiGet('/barras/ediciones?proyecto=' + encodeURIComponent(proy) + '&limit=20');
    var eds = (data && data.ediciones) || [];
    if (eds.length === 0) { card.style.display = 'none'; return; }
    card.style.display = '';
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
    cont.innerHTML = '<table style="width:100%; font-size:11px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;"><th style="padding:3px 6px;">Fecha</th><th style="padding:3px 6px;">Usuario</th><th style="padding:3px 6px;">Barra</th><th style="padding:3px 6px;">Cambios</th></tr>' +
      eds.map(function(e) {
        var fecha = (typeof formatDateTime === 'function') ? formatDateTime(e.fecha) : (e.fecha || '');
        var ubic = [e.sector, e.piso, e.eje].filter(Boolean).join('/');
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:3px 6px; white-space:nowrap;">' + esc(fecha) + '</td>' +
          '<td style="padding:3px 6px;">' + esc((e.usuario || '').split('@')[0]) + '</td>' +
          '<td style="padding:3px 6px; font-family:monospace;" title="' + esc(e.id_unico || '') + '">' + esc(ubic || (e.id_unico || '')) + '</td>' +
          '<td style="padding:3px 6px; color:#555;">' + esc(e.detalle || '') + '</td>' +
          '</tr>';
      }).join('') + '</table>';
  };

  // ---- Aviso al cerrar/recargar el navegador con cambios sin guardar (5M.9) ----
  // El navegador solo permite su diálogo genérico ("¿salir del sitio?"), no texto
  // propio; con eso basta para evitar perder cambios por accidente.
  window.addEventListener('beforeunload', function(e) {
    if (global.bmHayCambiosSinGuardar && global.bmHayCambiosSinGuardar()) {
      e.preventDefault();
      e.returnValue = '';   // requerido por los navegadores para disparar el aviso
      return '';
    }
  });
})(window);
