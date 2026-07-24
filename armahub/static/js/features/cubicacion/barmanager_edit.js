// ArmaHub — Bar Manager: edición de barras (5M.3)
// Modo edición con candado (toggle UI, no persiste). Campos simples editables
// (diam/cant_total/largo_total); tipología/geometría no aquí. Permisos y validación
// en el backend (PATCH /barras/{id}). Guardar-al-cerrar el candado. Panel de
// ediciones recientes de la obra al final.

(function(global) {
  // Estado del modo edición (solo UI). _cambios: id_barra -> {campo: valorNuevo}.
  var _modoEdicion = false;
  var _cambios = {};

  // 5M.11 — Modificación MASIVA en vista plana. Con el modo activo aparecen los
  // checkboxes; al editar una celda de una barra marcada, el cambio se replica
  // en tándem a TODAS las marcadas (misma columna). Sin modo masivo, edición
  // normal celda por celda.
  var _seleccion = {};      // { barraId: true } — barras marcadas
  var _modoMasivo = false;  // ¿modificación masiva activa? (muestra checkboxes + replica)

  global.bmEnModoEdicion = function() { return _modoEdicion; };
  global.bmEnModoMasivo = function() { return _modoEdicion && _modoMasivo; };
  global.bmSeleccionCount = function() { return Object.keys(_seleccion).length; };
  global.bmEstaSeleccionada = function(id) { return !!_seleccion[id]; };

  // Toggle del modo "Modificación masiva". Muestra/oculta los checkboxes.
  global.bmToggleModoMasivo = function() {
    _modoMasivo = !_modoMasivo;
    if (!_modoMasivo) _seleccion = {};   // al apagar, limpiar selección
    _actualizarBotonMasivo();
    if (typeof bmReRenderVistaActual === 'function') bmReRenderVistaActual();
    _actualizarBarraSeleccion();
    if (_modoMasivo) _poblarColsOperar();   // 5M.12: dropdowns de operar columnas
  };

  function _actualizarBotonMasivo() {
    var btn = document.getElementById('btnModMasiva');
    if (!btn) return;
    btn.style.display = _modoEdicion ? '' : 'none';
    if (_modoMasivo) {
      btn.textContent = '🔁 Modificación masiva: ON';
      btn.style.background = '#1565c0'; btn.style.color = '#fff'; btn.style.borderColor = '#1565c0';
    } else {
      btn.textContent = '🔁 Modificación masiva';
      btn.style.background = '#fff'; btn.style.color = '#1565c0'; btn.style.borderColor = '#1565c0';
    }
  }
  global.bmActualizarBotonMasivo = _actualizarBotonMasivo;

  // Alterna la selección de una barra (checkbox por fila).
  global.bmToggleSeleccion = function(id, checked) {
    if (id == null) return;
    id = String(id);
    if (checked) _seleccion[id] = true; else delete _seleccion[id];
    _actualizarBarraSeleccion();
  };

  // Selecciona / deselecciona TODAS las barras de la vista plana actual.
  global.bmToggleSeleccionTodas = function(checked) {
    _seleccion = {};
    if (checked && typeof lastBarrasPlano !== 'undefined' && lastBarrasPlano.forEach) {
      lastBarrasPlano.forEach(function(b) { if (b && b.id != null) _seleccion[String(b.id)] = true; });
    }
    // Re-render para reflejar los checkboxes de todas las filas.
    if (typeof bmReRenderVistaActual === 'function') bmReRenderVistaActual();
    _actualizarBarraSeleccion();
  };

  // Limpia la selección (al cambiar de obra, salir de edición, re-buscar).
  global.bmLimpiarSeleccion = function() {
    _seleccion = {};
    _actualizarBarraSeleccion();
  };

  // Actualiza la barra de estado de selección (contador). El panel de acciones
  // masivas se construye en el Paso 2; por ahora solo informa cuántas hay.
  function _actualizarBarraSeleccion() {
    var cont = document.getElementById('bmSeleccionBar');
    var lbl = document.getElementById('bmSeleccionCount');
    var n = Object.keys(_seleccion).length;
    if (lbl) lbl.textContent = n + ' barra' + (n === 1 ? '' : 's') + ' marcada' + (n === 1 ? '' : 's');
    // La barra aparece con el modo masivo activo (aunque aún no haya marcadas).
    if (cont) cont.style.display = (_modoEdicion && _modoMasivo) ? 'flex' : 'none';
    // Garantizar que los dropdowns de operar columnas estén poblados al mostrarse.
    if (_modoEdicion && _modoMasivo) {
      var so = document.getElementById('bmColOrigen');
      if (so && so.options.length === 0) _poblarColsOperar();
    }
  }
  global.bmActualizarBarraSeleccion = _actualizarBarraSeleccion;
  global.bmHayCambios = function() { return Object.keys(_cambios).length > 0; };
  // ¿Hay cambios sin guardar en la sesión de edición actual? Lo consulta la
  // navegación (cambio de sección) y el aviso de cerrar navegador (5M.9).
  global.bmHayCambiosSinGuardar = function() {
    return _modoEdicion && Object.keys(_cambios).length > 0;
  };

  // Reset del modo edición (al cambiar de obra). Descarta cambios sin guardar.
  global.bmResetModoEdicion = function() {
    _modoEdicion = false;
    _modoMasivo = false;
    _cambios = {};
    _seleccion = {};
    _actualizarBotonEdicion();
    _actualizarBotonMasivo();
    _actualizarBarraSeleccion();
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

  // Largo EFECTIVO de una barra si tiene cambios de geometría pendientes: suma los
  // lados que la figura USA, con los valores efectivos (cambio pendiente o memoria).
  // Réplica de largo_desde_lados del backend, para mostrar el largo YA actualizado
  // en pantalla (antes mostraba el viejo hasta guardar → confusión 192 vs 180).
  // Devuelve null si no hay cambios de geometría o la figura es desconocida.
  global.bmLargoEfectivo = function(b) {
    var id = String(b.id);
    var camb = _cambios[id];
    if (!camb) return null;
    var tocaGeom = ['figura','dim_a','dim_b','dim_c','dim_d','dim_e','dim_f','dim_g','dim_h','dim_i']
      .some(function(k) { return k in camb; });
    if (!tocaGeom) return null;
    var figura = ('figura' in camb) ? camb.figura : b.figura;
    var fig = _catFiguras[figura];
    if (!fig) return null;   // figura desconocida → que el backend recalcule al guardar
    var total = 0;
    (fig.parciales || []).forEach(function(l) {
      var col = 'dim_' + String(l).trim().toLowerCase();
      var v = (col in camb) ? camb[col] : b[col];
      var n = parseFloat(v);
      if (!isNaN(n)) total += n;
    });
    return total;
  };

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

  // FUENTE ÚNICA DE VERDAD para lo que se ve en una celda editable: si hay un
  // cambio pendiente para (barra, campo), ese manda; si no, el valor de memoria.
  // Con esto CUALQUIER re-render preserva los cambios sin guardar (antes el render
  // leía solo la memoria e "ignoraba" _cambios → los cambios desaparecían al
  // marcar todas / togglear masivo / paginar, y el estado se desincronizaba).
  // Devuelve { valor, tocado } — tocado=true para pintar la celda de amarillo.
  global.bmValorEfectivoCelda = function(id, campo, valorMemoria) {
    id = String(id);
    if (_cambios[id] && (campo in _cambios[id])) {
      return { valor: _cambios[id][campo], tocado: true };
    }
    return { valor: valorMemoria, tocado: false };
  };

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
      _modoMasivo = false;  // salir de edición apaga el modo masivo
      _seleccion = {};      // ...y limpia la selección
    } else {
      // Abriendo: warning explícito.
      if (!confirm('Vas a ACTIVAR el modo edición de barras.\n\nPodrás modificar diámetro, cantidad y la geometría (figura, lados A–I, ángulos, radio). El largo se calcula solo de los lados. La figura se valida contra el catálogo: NO podrás guardar una barra con lados/ángulos que sobran o faltan (quedan en ROJO para corregir).\n\nUsa el botón "💾 Guardar cambios". Los cambios quedan auditados. ¿Continuar?')) return;
      _modoEdicion = true;
      _cambios = {};
      await _cargarDatalistFiguras();   // 5M.4: figuras del catálogo para el input
    }
    _actualizarBotonEdicion();
    _actualizarBotonMasivo();
    // Re-render de la vista ACTIVA (plana o agrupada) para reflejar inputs /
    // solo-lectura. bmReRenderVistaActual bifurca según _modoVistaPlana (5M.9);
    // así el candado también cambia la grilla plana, no solo los desplegables.
    if (typeof bmReRenderVistaActual === 'function') bmReRenderVistaActual();
    else if (typeof reRenderDetallesAbiertos === 'function') reRenderDetallesAbiertos();
    _actualizarBarraSeleccion();
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
      btn.style.fontWeight = '600';
      if (_modoEdicion) {
        // Activo: ámbar LLENO para que se note que el modo está encendido.
        btn.textContent = '🔓 Salir de edición';
        btn.style.background = '#e65100';
        btn.style.borderColor = '#e65100';
        btn.style.color = '#fff';
        if (status) status.textContent = nCambios > 0 ? (nCambios + ' barra(s) con cambios sin guardar') : 'Modo edición activo — edita las celdas.';
      } else {
        // Bloqueado: ámbar suave que resalta entre los botones grises.
        btn.textContent = '🔒 Edición bloqueada';
        btn.style.background = '#fff3e0';
        btn.style.borderColor = '#ffb74d';
        btn.style.color = '#e65100';
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

  // Normaliza el valor de una celda según el campo (figura=texto/null; dim/áng
  // vacío=null para borrar; resto=número). Devuelve el valor a guardar.
  function _normalizarValorCelda(campo, val) {
    if (campo === 'figura') return (val === '') ? null : val;
    if (val === '') return null;   // vaciar dim/ángulo = borrar ese lado (5M.4)
    return parseFloat(val);
  }

  // Aplica un cambio de (campo→valor) a UNA barra: registra en _cambios, refleja
  // en su input (si está en pantalla), marca amarillo y revalida esa fila.
  function _aplicarCambioBarra(id, campo, valor) {
    id = String(id);
    _cambios[id] = _cambios[id] || {};
    _cambios[id][campo] = valor;
    var cell = document.getElementById('bmcell-' + id + '-' + campo);
    if (cell) {
      // Reflejar el valor en el input (para las réplicas que no fueron tecleadas).
      cell.value = (valor == null) ? '' : valor;
      cell.style.background = '#fff3cd';   // amarillo = modificado
    }
    _validarFilaLocal(id);
  }

  // ---- Registro de un cambio en un input (onchange desde el render) ----
  global.bmRegistrarCambio = function(el) {
    var id = el.getAttribute('data-barra-id');
    var campo = el.getAttribute('data-campo');
    if (!id || !campo) return;
    var valor = _normalizarValorCelda(campo, el.value.trim());
    _aplicarCambioBarra(id, campo, valor);

    // 5M.11: modificación MASIVA en tándem. Si el modo masivo está activo y la
    // barra editada está marcada, replicar este mismo cambio a TODAS las marcadas.
    if (_modoEdicion && _modoMasivo && _seleccion[String(id)]) {
      var ids = Object.keys(_seleccion);
      var n = 0;
      ids.forEach(function(otroId) {
        if (otroId === String(id)) return;   // la editada ya se aplicó
        _aplicarCambioBarra(otroId, campo, valor);
        n++;
      });
      if (n > 0 && typeof showToast === 'function') {
        showToast('Aplicado a ' + (n + 1) + ' barras marcadas (' + campo + ')', 'info');
      }
    }
    _actualizarBotonEdicion();
  };

  // ==== 5M.12: OPERAR COLUMNAS (copiar / intercambiar) sobre las marcadas ====
  // Se opera entre columnas del MISMO TIPO: lados parciales A-I, o ángulos α1-α4.
  // No se mezclan (no tiene sentido copiar un lado a un ángulo). R/φ/cant no aplican.
  var _COLS_LADOS = [
    { campo: 'dim_a', label: 'A' }, { campo: 'dim_b', label: 'B' }, { campo: 'dim_c', label: 'C' },
    { campo: 'dim_d', label: 'D' }, { campo: 'dim_e', label: 'E' }, { campo: 'dim_f', label: 'F' },
    { campo: 'dim_g', label: 'G' }, { campo: 'dim_h', label: 'H' }, { campo: 'dim_i', label: 'I' }
  ];
  var _COLS_ANGULOS = [
    { campo: 'ang1', label: 'α1' }, { campo: 'ang2', label: 'α2' }, { campo: 'ang3', label: 'α3' }, { campo: 'ang4', label: 'α4' }
  ];
  var _colTipo = 'lados';

  // Cambia el tipo (lados/ángulos) y repuebla los dropdowns con ese grupo.
  global.bmSetColTipo = function(tipo) {
    _colTipo = (tipo === 'angulos') ? 'angulos' : 'lados';
    _poblarColsOperar();
  };

  // Puebla los dropdowns de columna origen/destino con el grupo del tipo activo.
  function _poblarColsOperar() {
    var so = document.getElementById('bmColOrigen'), sd = document.getElementById('bmColDestino');
    if (!so || !sd) return;
    var cols = (_colTipo === 'angulos') ? _COLS_ANGULOS : _COLS_LADOS;
    var opts = cols.map(function(c) { return '<option value="' + c.campo + '">' + c.label + '</option>'; }).join('');
    so.innerHTML = opts; sd.innerHTML = opts;
    if (sd.options.length > 1) sd.selectedIndex = 1;   // destino distinto por defecto
    // Flecha según la operación.
    var op = document.getElementById('bmColOp'), fl = document.getElementById('bmColFlecha');
    if (op && fl) { op.onchange = function() { fl.textContent = (op.value === 'intercambiar') ? '↔' : '→'; }; }
  }

  // Valor EFECTIVO de una columna en una barra: el cambio pendiente si existe,
  // si no el valor en memoria (lastBarrasPlano).
  function _valorEfectivo(id, campo) {
    id = String(id);
    if (_cambios[id] && (campo in _cambios[id])) return _cambios[id][campo];
    if (typeof lastBarrasPlano !== 'undefined' && lastBarrasPlano.forEach) {
      for (var i = 0; i < lastBarrasPlano.length; i++) {
        if (String(lastBarrasPlano[i].id) === id) return lastBarrasPlano[i][campo];
      }
    }
    return null;
  }

  // Aplica copiar/intercambiar entre 2 columnas a TODAS las barras marcadas.
  global.bmOperarColumnas = function() {
    if (!_modoEdicion || !_modoMasivo) return;
    var ids = Object.keys(_seleccion);
    if (ids.length === 0) { if (typeof showToast === 'function') showToast('Marca al menos una barra', 'info'); return; }
    var op = (document.getElementById('bmColOp') || {}).value || 'copiar';
    var origen = (document.getElementById('bmColOrigen') || {}).value;
    var destino = (document.getElementById('bmColDestino') || {}).value;
    if (!origen || !destino) return;
    if (origen === destino) { alert('La columna de origen y destino deben ser distintas.'); return; }
    ids.forEach(function(id) {
      var vOrig = _valorEfectivo(id, origen);
      if (op === 'intercambiar') {
        var vDest = _valorEfectivo(id, destino);
        _aplicarCambioBarra(id, destino, vOrig);
        _aplicarCambioBarra(id, origen, vDest);
      } else {   // copiar: origen → destino (pisa destino; origen queda igual)
        _aplicarCambioBarra(id, destino, vOrig);
      }
    });
    var labOr = _labelCol(origen), labDe = _labelCol(destino);
    var verbo = (op === 'intercambiar') ? ('intercambió ' + labOr + ' ↔ ' + labDe) : ('copió ' + labOr + ' → ' + labDe);
    if (typeof showToast === 'function') showToast('Se ' + verbo + ' en ' + ids.length + ' barra(s) marcada(s)', 'info');
    _actualizarBotonEdicion();
  };

  function _labelCol(campo) {
    var todas = _COLS_LADOS.concat(_COLS_ANGULOS);
    for (var i = 0; i < todas.length; i++) if (todas[i].campo === campo) return todas[i].label;
    return campo;
  }

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
  // PATCH de UNA barra. Aísla el resultado (ok/fallida/401) para que el llamador
  // decida qué hacer sin que una excepción de esta barra tumbe a las demás.
  async function _guardarUnaBarra(id) {
    try {
      var res = await fetch(apiUrl('/barras/' + encodeURIComponent(id)), {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(_cambios[id])
      });
      if (res.status === 401) return { id: id, auth401: true };
      // El backend SIEMPRE responde JSON (incluso sus errores 500), pero nos
      // blindamos igual: si por lo que sea la respuesta no es JSON parseable, esta
      // barra queda "fallida" sin afectar a las demás.
      var data = null;
      try { data = await res.json(); } catch (parseErr) { data = null; }
      if (res.ok && data && data.ok) return { id: id, ok: true, data: data };
      if (res.status === 409 && data && data.detail && data.detail.geometria_invalida) {
        return { id: id, ok: false, geomInvalida: true, detail: data.detail };
      }
      return { id: id, ok: false, error: (data && data.detail) ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : ('HTTP ' + res.status) };
    } catch (netErr) {
      return { id: id, ok: false, error: 'Error de conexión: ' + (netErr && netErr.message ? netErr.message : netErr) };
    }
  }

  // Guarda TODAS las barras con cambios EN PARALELO (por lotes, no una por una).
  // Antes era un PATCH secuencial por barra (await dentro de un for) → con N
  // barras, N round-trips en SERIE (lento, sobre todo con cold start de Render).
  // Ahora se procesan lotes de _BM_LOTE en paralelo — mismo resultado, mucho más
  // rápido, sin saturar el backend con cientos de requests simultáneas.
  var _BM_LOTE = 6;
  async function _guardarCambios() {
    var ids = Object.keys(_cambios);
    if (ids.length === 0) return true;
    var okCount = 0;
    var fallidas = [];   // ids que no pasaron validación (quedan pendientes)
    var otroError = '';
    var nGeom = 0, nServidor = 0;   // desglose de fallidas: geometría vs error server
    for (var i = 0; i < ids.length; i += _BM_LOTE) {
      var lote = ids.slice(i, i + _BM_LOTE);
      var resultados = await Promise.all(lote.map(_guardarUnaBarra));
      for (var j = 0; j < resultados.length; j++) {
        var r = resultados[j];
        if (r.auth401) { logout(); return false; }
        if (r.ok) {
          okCount++;
          delete _cambios[r.id];   // guardada: quitar de pendientes
          // Optimistic update (5M.9): actualizar la barra en memoria con lo que
          // devolvió el backend (peso/largo recalculados), sin re-pedir la lista.
          if (r.data.barra && typeof bmActualizarBarraEnMemoria === 'function') {
            bmActualizarBarraEnMemoria(r.data.barra);
          }
        } else if (r.geomInvalida) {
          fallidas.push(r.id);
          nGeom++;
          _resaltarSlots(r.id, r.detail.slots_sobran, 'sobra');
          _resaltarSlots(r.id, r.detail.slots_faltan, 'falta');
        } else {
          fallidas.push(r.id);
          nServidor++;
          if (!otroError) otroError = r.error;
        }
      }
    }
    if (fallidas.length > 0) {
      // Hay barras con problemas: NO re-renderizar (perdería el resaltado rojo).
      // Solo actualizar el panel de ediciones si algo se guardó.
      if (okCount > 0 && typeof cargarEdicionesRecientes === 'function') cargarEdicionesRecientes();
      // Mensaje diferenciado: geometría (culpa del dato, corregible en ROJO) vs
      // error del servidor (NO es culpa del usuario; sus cambios se conservan).
      var msg = okCount + ' guardada(s).';
      if (nGeom > 0) msg += ' ' + nGeom + ' con geometría incoherente: corrige lo marcado en ROJO (sobra/falta).';
      if (nServidor > 0) msg += ' ' + nServidor + ' falló por error del servidor (tus cambios se conservan, reintenta).' + (otroError ? (' Detalle: ' + otroError) : '');
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
