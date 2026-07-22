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

  // Reset del modo edición (al cambiar de obra). Descarta cambios sin guardar.
  global.bmResetModoEdicion = function() {
    _modoEdicion = false;
    _cambios = {};
    _actualizarBotonEdicion();
  };

  // Datalist de figuras del catálogo (5M.4), cargado una vez al activar edición.
  var _figurasCargadas = false;
  async function _cargarDatalistFiguras() {
    if (_figurasCargadas) return;
    var dl = document.getElementById('bmFigurasDatalist');
    if (!dl) return;
    var data = await apiGet('/figuras-catalogo');
    var figs = (data && data.figuras) || [];
    dl.innerHTML = figs.map(function(f) {
      return '<option value="' + f.codigo + '">' + f.codigo + ' (' + (f.parciales || []).join('') + ')</option>';
    }).join('');
    _figurasCargadas = true;
  }

  // ---- Toggle candado ----
  global.toggleModoEdicion = async function() {
    if (_modoEdicion) {
      // Cerrando el candado: si hay cambios, preguntar si guardar.
      if (Object.keys(_cambios).length > 0) {
        if (confirm('Tienes cambios sin guardar. ¿Deseas guardarlos?')) {
          var ok = await _guardarCambios();
          if (!ok) return; // si falló, seguir en modo edición
        } else {
          _cambios = {}; // descartar
        }
      }
      _modoEdicion = false;
    } else {
      // Abriendo: warning explícito.
      if (!confirm('Vas a ACTIVAR el modo edición de barras.\n\nPodrás modificar diámetro, cantidad, largo y la geometría (figura, lados A–I, ángulos, radio) de barras individuales. La figura se valida contra el catálogo: NO podrás guardar una barra con lados que sobran o faltan (quedan marcados en rojo para que los corrijas).\n\nLos cambios quedan auditados. Edita solo lo necesario. ¿Continuar?')) return;
      _modoEdicion = true;
      _cambios = {};
      await _cargarDatalistFiguras();   // 5M.4: figuras del catálogo para el input
    }
    _actualizarBotonEdicion();
    // Re-render del detalle abierto para reflejar inputs / solo-lectura.
    if (typeof reRenderDetallesAbiertos === 'function') reRenderDetallesAbiertos();
  };

  function _actualizarBotonEdicion() {
    var btn = document.getElementById('btnEdicionBarras');
    var status = document.getElementById('edicionStatus');
    if (!btn) return;
    if (_modoEdicion) {
      btn.textContent = '🔓 Edición activa — clic para bloquear/guardar';
      btn.style.background = '#fff3e0';
      btn.style.borderColor = '#e65100';
      btn.style.color = '#e65100';
      if (status) status.textContent = 'Modo edición: modifica y luego bloquea para guardar.';
    } else {
      btn.textContent = '🔒 Edición bloqueada';
      btn.style.background = '#eee';
      btn.style.borderColor = '#ccc';
      btn.style.color = '#333';
      if (status) status.textContent = '';
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
    // Limpiar resaltado de error rojo al corregir; marcar celda modificada.
    el.style.border = '';
    el.title = '';
    el.style.background = '#fff3cd';
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
    // Refrescar solo si hubo guardados (los pesos cambiaron).
    if (okCount > 0) {
      if (typeof detailCache !== 'undefined' && detailCache.clear) detailCache.clear();
      if (typeof buscar === 'function') await buscar(false);
      if (typeof cargarEdicionesRecientes === 'function') cargarEdicionesRecientes();
    }
    if (fallidas.length > 0) {
      var msg = okCount + ' guardada(s). ' + fallidas.length + ' con geometría incoherente: corrige los lados marcados en rojo antes de guardar.' + (otroError ? (' Otro error: ' + otroError) : '');
      if (typeof showToast === 'function') showToast(msg, 'error');
      return false;   // deja el candado abierto para corregir
    }
    if (typeof showToast === 'function') showToast(okCount + ' barra(s) actualizada(s)', 'success');
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
})(window);
