// ArmaHub Reclamos — Detail View: Edición / interacción (Fase 4 del refactor)
// Edición de datos del reclamo, respuesta/análisis, aplica, acciones (medidas),
// uploads de imágenes, seguimientos, ishikawa, eliminar y PDF. Es la parte de
// ESCRITURA del modal (el render vive en detail-render.js, el flujo en
// detail-flow.js, los permisos en detail-permissions.js).
//
// Genérico: reutilizable por cualquier listado (Clientes, Internos).

function descargarPdfReclamo() {
  if (!_reclamoActual) return;
  var url = apiUrl('/reclamos/' + _reclamoActual.id + '/pdf');
  fetch(url, { headers: authHeaders() })
    .then(function(res) {
      if (!res.ok) throw new Error('Error al generar PDF');
      return res.blob();
    })
    .then(function(blob) {
      var blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    })
    .catch(function(err) {
      showToast(err.message || 'Error al generar PDF', 'error');
    });
}

function toggleEditarReclamo() {
  var form = document.getElementById('recEditForm');
  var info = document.getElementById('recDetailInfo');
  if (form.style.display === 'none') {
    // Open edit mode — populate fields from current reclamo
    var d = _reclamoActual;
    if (!d) return;
    document.getElementById('recEditTitulo').value = d.titulo || '';
    document.getElementById('recEditTipo').value = d.tipo_reclamo || 'error';
    document.getElementById('recEditFechaDeteccion').value = d.fecha_deteccion || '';
    document.getElementById('recEditAnioCalidad').value = d.anio_calidad || '';
    document.getElementById('recEditNumeroCalidad').value = d.numero_calidad || '';
    // anio_calidad: only admin can edit
    document.getElementById('recEditAnioCalidad').disabled = !(currentRole === 'admin' || currentRole === 'admin_calidad');
    document.getElementById('recEditDetectadoPor').value = d.detectado_por || '';
    document.getElementById('recEditDescripcion').value = d.descripcion || '';
    // Populate proyecto dropdown from recProyecto select (already loaded)
    var proySel = document.getElementById('recEditProyecto');
    var srcProySel = document.getElementById('recProyecto');
    if (proySel && srcProySel) {
      proySel.innerHTML = '<option value="">— Sin proyecto —</option>';
      Array.from(srcProySel.options).forEach(function(opt) {
        if (opt.value) proySel.innerHTML += '<option value="' + opt.value + '">' + opt.textContent + '</option>';
      });
      proySel.value = d.id_proyecto || '';
    }
    // Populate "Cubicador Responsable" dropdown (only cubicador/externo)
    var sel = document.getElementById('recEditResponsable');
    sel.innerHTML = '<option value="">— Sin asignar —</option>';
    _recUsersCache.filter(function(u) { return u.role === 'cubicador' || u.role === 'externo'; }).forEach(function(u) {
      sel.innerHTML += '<option value="' + u.email + '" data-display="' + u.display + '">' + u.display + '</option>';
    });
    sel.value = d.cubicador_asignado || '';
    // USC Responsable dropdown — only admin/admin_calidad
    var uscWrap = document.getElementById('recEditAsignadoAWrap');
    var uscSel = document.getElementById('recEditAsignadoA');
    if (uscWrap && uscSel) {
      if (currentRole === 'admin' || currentRole === 'admin_calidad') {
        uscWrap.style.display = '';
        // Populate from loadUsuariosUsc cache (recAsignadoA source)
        var srcUsc = document.getElementById('recAsignadoA');
        uscSel.innerHTML = '<option value="">— Sin asignar —</option>';
        if (srcUsc) {
          Array.from(srcUsc.options).forEach(function(opt) {
            if (opt.value) uscSel.innerHTML += '<option value="' + opt.value + '">' + opt.textContent + '</option>';
          });
        }
        uscSel.value = d.asignado_a || '';
      } else {
        uscWrap.style.display = 'none';
      }
    }
    document.getElementById('recEditMsg').textContent = '';
    form.style.display = '';
    info.style.display = 'none';
    document.getElementById('btnEditarReclamo').textContent = '✕ Cancelar';
  } else {
    form.style.display = 'none';
    info.style.display = '';
    document.getElementById('btnEditarReclamo').textContent = '✏️ Editar';
  }
}

async function guardarEdicionReclamo() {
  if (!_reclamoActual) return;
  var esCreador = _reclamoActual.creado_por && _reclamoActual.creado_por === currentUserEmail;
  var puedeEditar = (currentRole === 'admin' || currentRole === 'admin_calidad') || (currentRole === 'usc' && esCreador);
  if (_reclamoActual.validacion_resultado && currentRole !== 'admin') puedeEditar = false;
  if (!puedeEditar) { alert('No tienes permiso para editar este reclamo.'); return; }
  var msg = document.getElementById('recEditMsg');
  var titulo = document.getElementById('recEditTitulo').value.trim();
  if (!titulo) { msg.textContent = 'El título es obligatorio'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  var editRespSel = document.getElementById('recEditResponsable');
  var editRespEmail = editRespSel.value || null;
  var editRespDisplay = editRespSel.options[editRespSel.selectedIndex] ? editRespSel.options[editRespSel.selectedIndex].getAttribute('data-display') : null;
  var editProySel = document.getElementById('recEditProyecto');
  var editProyVal = editProySel ? editProySel.value : null;
  var body = {
    titulo: titulo,
    descripcion: document.getElementById('recEditDescripcion').value.trim() || null,
    tipo_reclamo: document.getElementById('recEditTipo').value,
    fecha_deteccion: document.getElementById('recEditFechaDeteccion').value || null,
    detectado_por: document.getElementById('recEditDetectadoPor').value || null,
    responsable: editRespDisplay || editRespEmail,
    cubicador_asignado: editRespEmail || '',
    id_calidad: null,
    anio_calidad: parseInt(document.getElementById('recEditAnioCalidad').value) || null,
    numero_calidad: parseInt(document.getElementById('recEditNumeroCalidad').value) || null,
    id_proyecto: editProyVal || null,
  };
  // USC Responsable — only send if admin/admin_calidad
  if (currentRole === 'admin' || currentRole === 'admin_calidad') {
    var editUscSel = document.getElementById('recEditAsignadoA');
    if (editUscSel) body.asignado_a = editUscSel.value || null;
  }
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Guardado'; msg.style.color = '#558B2F';
    // Close edit form and refresh
    document.getElementById('recEditForm').style.display = 'none';
    document.getElementById('recDetailInfo').style.display = '';
    document.getElementById('btnEditarReclamo').textContent = '✏️ Editar';
    await verReclamo(_reclamoActual.id);
    await loadReclamos();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function guardarAnioNumeroCalidad() {
  if (!_reclamoActual) return;
  var anio = parseInt(document.getElementById('recDetailAnioCalidad').value) || null;
  var num = parseInt(document.getElementById('recDetailNumeroCalidad').value) || null;
  if (anio === (_reclamoActual.anio_calidad || null) && num === (_reclamoActual.numero_calidad || null)) return;
  var body = {};
  body.anio_calidad = anio;
  body.numero_calidad = num;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function cambiarProyectoReclamo() {
  if (!_reclamoActual) return;
  var val = document.getElementById('recDetailProyecto').value;
  if (val === (_reclamoActual.id_proyecto || '')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_proyecto: val || '' })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function cambiarAsignadoAReclamo() {
  if (!_reclamoActual) return;
  var val = document.getElementById('recDetailAsignadoA').value;
  if (val === (_reclamoActual.asignado_a || '')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ asignado_a: val || '' })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function loadUsuariosUsc() {
  var res = await fetch(apiUrl('/reclamos/usuarios-usc'), { headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  var usuarios = data.data || data.usuarios || [];
  
  // Update creation form dropdown
  var createSelect = document.getElementById('recAsignadoA');
  if (createSelect) {
    createSelect.innerHTML = '<option value="">— Auto-asignar —</option>';
    usuarios.forEach(function(u) {
      var opt = document.createElement('option');
      opt.value = u.email;
      opt.textContent = u.display;
      createSelect.appendChild(opt);
    });
  }
  
  // Update detail form dropdown
  var detailSelect = document.getElementById('recDetailAsignadoA');
  if (detailSelect) {
    detailSelect.innerHTML = '<option value="">— Sin asignar —</option>';
    usuarios.forEach(function(u) {
      var opt = document.createElement('option');
      opt.value = u.email;
      opt.textContent = u.display;
      detailSelect.appendChild(opt);
    });
  }
}

function _updateAplicaBadge() {
  var sel = document.getElementById('recDetailAplica');
  if (!sel) return;
  var v = sel.value;
  if (v === 'si') {
    sel.style.background = '#e8f5e9'; sel.style.borderColor = '#4caf50'; sel.style.color = '#2e7d32';
  } else if (v === 'no') {
    sel.style.background = '#ffebee'; sel.style.borderColor = '#e53935'; sel.style.color = '#b42318';
  } else {
    sel.style.background = '#fff8e1'; sel.style.borderColor = '#ffa000'; sel.style.color = '#e65100';
  }
}

function _clearReclamoCausaFields() {
  document.getElementById('recDetailCausaDisplay').value = '';
  document.getElementById('recDetailCategoria').value = '';
  document.getElementById('recDetailSubCausa').value = '';
  document.getElementById('recDetailCodCausa').value = '';
}

function clearReclamoCausa() {
  _clearReclamoCausaFields();
}

async function cambiarAplicaReclamo() {
  if (!_reclamoActual) return;
  var val = document.getElementById('recDetailAplica').value;
  if (val === (_reclamoActual.aplica || 'pendiente')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ aplica: val })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    if (val === 'no') {
      _clearReclamoCausaFields();
    }
    await verReclamo(_reclamoActual.id);
    await loadReclamos();
    await loadRecLanding();
  }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// ---- Análisis Causa Raíz ----
async function guardarRespuesta() {
  if (!_reclamoActual) return;
  var msg = document.getElementById('recRespMsg');
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  try {
    // PATCH no destructivo: el body incluye SOLO los campos con valor real.
    // Un campo vacío no se envía → el backend no lo toca (no borra datos en BD).
    var body = {};
    var _setIf = function(key, val) { if (val !== '' && val != null && !(typeof val === 'number' && isNaN(val))) body[key] = val; };

    _setIf('respuesta_texto', document.getElementById('recDetailRespuestaTexto').value.trim());
    _setIf('categoria_ishikawa', document.getElementById('recDetailCategoria').value);
    _setIf('sub_causa', document.getElementById('recDetailSubCausa').value);
    _setIf('cod_causa', document.getElementById('recDetailCodCausa').value);
    // area_aplica ya no se envía: el área real vive en area_id (inferida del responsable).
    _setIf('fecha_analisis', document.getElementById('recDetailFechaAnalisis').value);
    _setIf('kilos_mal_fabricados', parseFloat(document.getElementById('recDetailKilosMal').value));
    _setIf('tiempo_respuesta', parseInt(document.getElementById('recTiempoRespuestaAnalisis').value));
    // unidad solo si hay un tiempo asociado
    if (body.tiempo_respuesta != null) {
      body.tiempo_respuesta_unidad = document.getElementById('recTiempoRespuestaUnidadAnalisis').value || 'horas';
    }
    // Auto-change state to "en_analisis" if current state is "abierto"
    if (_reclamoActual.estado === 'abierto') {
      body.estado = 'en_analisis';
    }
    var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      msg.textContent = 'Respuesta guardada'; msg.style.color = '#558B2F';
      setTimeout(function() { msg.textContent = ''; }, 2000);
      await verReclamo(_reclamoActual.id);
      await loadReclamos(); await loadRecLanding();
    } else {
      msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
    }
  } catch (err) {
    console.error('[guardarRespuesta] Error:', err);
    msg.textContent = 'Error JS: ' + err.message; msg.style.color = '#b42318';
  }
}

// ---- Acciones (medidas correctivas/preventivas) ----
async function agregarAccion() {
  if (!_reclamoActual) return;
  var desc = document.getElementById('recNuevaAccionDesc').value.trim();
  var responsable = document.getElementById('recNuevaAccionResp').value;
  
  // Validaciones requeridas
  if (!desc) { 
    alert('⚠️ La descripción es requerida'); 
    document.getElementById('recNuevaAccionDesc').focus();
    return; 
  }
  
  if (!responsable || responsable.trim() === '') { 
    alert('⚠️ Debes asignar un responsable para la acción'); 
    var respField = document.getElementById('recNuevaAccionResp');
    respField.style.borderColor = '#f44336';
    respField.style.backgroundColor = '#ffebee';
    respField.focus();
    
    // Restaurar estilo normal después de 2 segundos
    setTimeout(function() {
      respField.style.borderColor = '#e0e0e0';
      respField.style.backgroundColor = '';
    }, 2000);
    
    return; 
  }
  
  // Guardar estado actual del formulario para preservar datos
  var formState = {
    tipo: document.getElementById('recNuevaAccionTipo').value,
    responsable: responsable,
    fecha_prevista: document.getElementById('recNuevaAccionFecha').value
  };
  
  var body = {
    tipo: formState.tipo,
    descripcion: desc,
    responsable: formState.responsable,
    fecha_prevista: formState.fecha_prevista || null,
  };
  
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id + '/acciones'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    // Solo limpiar la descripción, preservar el resto del formulario
    document.getElementById('recNuevaAccionDesc').value = '';
    
    // Mostrar feedback temporal con responsable
    var descField = document.getElementById('recNuevaAccionDesc');
    var originalPlaceholder = descField.placeholder;
    var responsableName = formState.responsable;
    descField.placeholder = '✅ Acción asignada a ' + responsableName + '. Ingresa otra descripción...';
    descField.style.background = '#e8f5e9';
    
    // Restaurar estado normal después de 2 segundos
    setTimeout(function() {
      descField.placeholder = originalPlaceholder;
      descField.style.background = '';
    }, 2000);
    
    // Recargar solo la lista de acciones, no todo el reclamo
    await refreshAccionesList();
    
    // Poner foco en la descripción para facilitar agregar otra acción
    descField.focus();
    
  } else { 
    alert('Error: ' + (data.detail || 'desconocido')); 
  }
}

// Función optimizada para recargar solo las acciones sin perder datos del formulario
async function refreshAccionesList() {
  if (!_reclamoActual) return;
  
  try {
    var detail = await apiGet('/reclamos/' + _reclamoActual.id);
    if (detail) {
      renderAcciones(_normalizeReclamoDetail(detail).acciones_normalized);
    }
  } catch (error) {
    console.error('Error al recargar acciones:', error);
    // Fallback: recargar todo el reclamo si falla la carga parcial
    await verReclamo(_reclamoActual.id);
  }
}

async function eliminarAccion(accionId) {
  if (!_reclamoActual) return;
  if (!confirm('¿Eliminar esta acción?')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id + '/acciones/' + accionId), {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { 
    // Recargar solo la lista de acciones, no todo el reclamo
    await refreshAccionesList();
  }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// Función para limpiar el formulario de acciones manualmente
function limpiarFormularioAcciones() {
  document.getElementById('recNuevaAccionDesc').value = '';
  document.getElementById('recNuevaAccionResp').value = '';
  document.getElementById('recNuevaAccionFecha').value = '';
  document.getElementById('recNuevaAccionTipo').value = 'inmediata';
  
  // Mostrar feedback
  var descField = document.getElementById('recNuevaAccionDesc');
  var originalPlaceholder = descField.placeholder;
  descField.placeholder = 'Formulario limpiado';
  descField.style.background = '#fff3e0';
  
  setTimeout(function() {
    descField.placeholder = originalPlaceholder;
    descField.style.background = '';
  }, 1000);
  
  descField.focus();
}

// ---- Imágenes: Drop Zone System ----
var _recCreateStagedFiles = [];

function _initDropZone(zoneId, fileInputId, onFiles) {
  return bindDropZone(zoneId, fileInputId, onFiles, {
    fileFilter: function(file) {
      return !!(file && file.type && file.type.startsWith('image/'));
    }
  });
}


function _addCreatePreview(files) {
  appendImagePreviewItems(files, _recCreateStagedFiles, {
    previewId: 'recCreatePreview',
    emptyHintId: 'recCreateDropMsg'
  });
}

async function _uploadFilesWithTipo(files, tipo, msgElId) {
  if (!_reclamoActual) return;
  var msg = document.getElementById(msgElId);
  if (msg) { msg.textContent = 'Subiendo ' + files.length + ' imagen(es)...'; msg.style.color = '#666'; }
  try {
    var result = await uploadFilesSequentially(files, {
      buildRequest: function(file) {
        var formData = new FormData();
        formData.append('file', file);
        formData.append('tipo', tipo);
        return {
          url: apiUrl('/reclamos/' + _reclamoActual.id + '/imagenes'),
          fetchOptions: { method: 'POST', headers: authHeaders(), body: formData }
        };
      },
      onUnauthorized: logout
    });
    if (!result.ok) {
      if (msg && !result.unauthorized) {
        msg.textContent = 'Error: ' + (result.detail || 'desconocido');
        msg.style.color = '#b42318';
      }
      return;
    }
    if (msg) { msg.textContent = files.length + ' imagen(es) subida(s)'; msg.style.color = '#558B2F'; setTimeout(function() { msg.textContent = ''; }, 3000); }
    await verReclamo(_reclamoActual.id, { preserveAnalysisDraft: true });
  } catch (err) {
    console.error('[_uploadFilesWithTipo] Error:', err);
    if (msg) { msg.textContent = 'Error de red al subir imagen'; msg.style.color = '#b42318'; }
  }
}

function initRecImageDropZones() {
  _initDropZone('recCreateDropZone', 'recCreateFileInput', _addCreatePreview);
  _initDropZone('recDetailDropZone', 'recDetailFileInput', function(files) { _uploadFilesWithTipo(files, 'antecedente', 'recImagenMsg'); });
  _initDropZone('recRespDropZone', 'recRespFileInput', function(files) { _uploadFilesWithTipo(files, 'respuesta', 'recRespImagenMsg'); });
}

async function eliminarImagen(imgId) {
  if (!_reclamoActual) return;
  if (!confirm('¿Eliminar esta imagen?')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id + '/imagenes/' + imgId), {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id, { preserveAnalysisDraft: true }); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// ---- Seguimientos ----
async function agregarSeguimiento() {
  if (!_reclamoActual) return;
  var comentario = document.getElementById('recSeguimientoComentario').value.trim();
  var estadoNuevo = document.getElementById('recSeguimientoEstado').value;
  var msg = document.getElementById('recSeguimientoMsg');
  if (!comentario) { msg.textContent = 'Ingresa un comentario'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Agregando...'; msg.style.color = '#666';
  var body = { comentario: comentario };
  if (estadoNuevo) body.estado_nuevo = estadoNuevo;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id + '/seguimientos'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = '';
    document.getElementById('recSeguimientoComentario').value = '';
    document.getElementById('recSeguimientoEstado').value = '';
    await verReclamo(_reclamoActual.id);
    await loadReclamos();
    await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function eliminarReclamo() {
  if (!_reclamoActual) return;
  if (!confirm('¿Eliminar reclamo #' + _reclamoActual.id + ' "' + _reclamoActual.titulo + '"? Esta acción no se puede deshacer.')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    _reclamoActual = null;
    closeReclamoModal();
    await loadReclamos();
    await loadRecLanding();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

// ---- Ishikawa Modal ----
async function abrirIshikawaModal(target) {
  _ishikawaTarget = target || 'create';
  
  // Preserve existing selection if it exists
  var existingCat = document.getElementById('recDetailCategoria').value;
  var existingSub = document.getElementById('recDetailSubCausa').value;
  var existingCod = document.getElementById('recDetailCodCausa').value;
  
  if (existingCat && existingSub && existingCod) {
    _ishikawaSelection = { categoria: existingCat, sub_causa: existingSub, cod_causa: existingCod };
    var catLabel = _recIshikawaLabels[existingCat] || existingCat;
    document.getElementById('ishikawaSelectedDisplay').textContent = '[' + existingCod + '] ' + catLabel + ' > ' + existingSub;
  } else {
    _ishikawaSelection = { categoria: '', sub_causa: '', cod_causa: '' };
    document.getElementById('ishikawaSelectedDisplay').textContent = 'Ninguna';
  }

  if (!_ishikawaData) {
    _ishikawaData = await apiGet('/reclamos/ishikawa');
  }
  if (!_ishikawaData || !(_ishikawaData.data || _ishikawaData.categorias)) return;
  var ishikawaCats = _ishikawaData.data || _ishikawaData.categorias;

  var grid = document.getElementById('ishikawaGrid');
  grid.innerHTML = ishikawaCats.map(function(cat) {
    var color = _ishikawaCatColors[cat.key] || '#666';
    return '<div style="border:2px solid ' + color + '; border-radius:8px; overflow:hidden;">' +
      '<div style="background:' + color + '; color:#fff; padding:6px 10px; font-weight:600; font-size:13px;">' + cat.label + '</div>' +
      '<div style="padding:6px 8px; max-height:220px; overflow-y:auto;">' +
      cat.subcausas.map(function(sc) {
        var value = cat.key + '|' + sc.cod + '|' + sc.texto;
        var checked = (_ishikawaSelection.categoria === cat.key && _ishikawaSelection.cod_causa === sc.cod) ? 'checked' : '';
        return '<label style="display:block; padding:3px 0; font-size:11px; cursor:pointer; line-height:1.3;">' +
          '<input type="radio" name="ishikawa_causa" value="' + value + '" ' + checked + ' ' +
          'onchange="seleccionarIshikawa(this)" style="margin-right:4px;" />' +
          '<strong>[' + sc.cod + ']</strong> ' + sc.texto +
          '</label>';
      }).join('') +
      '</div></div>';
  }).join('');

  showModal('ishikawaModal', '');
}

function seleccionarIshikawa(radio) {
  var parts = radio.value.split('|');
  _ishikawaSelection = { categoria: parts[0], cod_causa: parts[1], sub_causa: parts[2] };
  var catLabel = _recIshikawaLabels[parts[0]] || parts[0];
  document.getElementById('ishikawaSelectedDisplay').textContent = '[' + parts[1] + '] ' + catLabel + ' > ' + parts[2];
}

function confirmarIshikawa() {
  if (!_ishikawaSelection.categoria) { alert('Selecciona una causa primero'); return; }
  var displayText = '[' + _ishikawaSelection.cod_causa + '] ' + (_recIshikawaLabels[_ishikawaSelection.categoria] || '') + ' > ' + _ishikawaSelection.sub_causa;
  document.getElementById('recDetailCausaDisplay').value = displayText;
  document.getElementById('recDetailCategoria').value = _ishikawaSelection.categoria;
  document.getElementById('recDetailSubCausa').value = _ishikawaSelection.sub_causa;
  document.getElementById('recDetailCodCausa').value = _ishikawaSelection.cod_causa;
  cerrarIshikawaModal();
}

function cerrarIshikawaModal() {
  hideModal('ishikawaModal');
}

// ESC to close Ishikawa modal
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    if (isModalOpen('ishikawaModal')) {
      cerrarIshikawaModal();
    }
  }
});
