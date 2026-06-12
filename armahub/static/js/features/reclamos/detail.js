// ArmaHub Reclamos — Detail View
// Split from index.js (PC.17.7)

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

// NOTA (refactor):
//  - Fase 1: render de ficha + borrador → detail-render.js
//  - Fase 2: _applyReclamoDetailPermissions (permisos/visibilidad) → detail-permissions.js
// Aquí permanecen, por ahora: flujo/navegación (Fase 3), edición/respuesta/
// acciones/uploads/ishikawa/varios (Fase 4).

// Origen desde el que se abrió el modal de detalle:
//  'validaciones' → abierto desde las colas del sub-tab Validaciones; muestra las
//                   secciones de acción (revisión ámbar / validación verde).
//  'lista' (o vacío) → abierto desde el listado oficial (Reclamos Clientes); el
//                   modal es solo lectura/registro, SIN secciones de acción de flujo.
var _recModalOrigen = 'lista';

async function verReclamo(id, options) {
  options = options || {};
  // Preservar el borrador de análisis SIEMPRE que recarguemos el mismo reclamo
  // que ya está abierto (cambio de estado, agregar acción, cambiar aplica, etc.).
  // Así no se pierde lo que el usuario está escribiendo. Solo se descarta al
  // navegar a OTRO reclamo (id distinto) o si se pide explícitamente lo contrario.
  var esMismoReclamo = _reclamoActual && String(_reclamoActual.id) === String(id);
  // Origen del modal (controla si se muestran las secciones de flujo ámbar/verde):
  //  - Toda apertura externa pasa origen explícito: la lista oficial manda
  //    {origen:'lista'}, las colas de Validaciones {origen:'validaciones'}.
  //  - Las recargas internas tras una acción (verReclamo sin origen, mismo id)
  //    CONSERVAN el origen vigente, para no perder el contexto del modal abierto.
  //  - Cualquier otra apertura sin origen defaultea a 'lista' (lo seguro).
  if (options.origen) {
    _recModalOrigen = options.origen;
  } else if (!esMismoReclamo) {
    _recModalOrigen = 'lista';
  }
  var preservar = options.preserveAnalysisDraft !== false && (options.preserveAnalysisDraft === true || esMismoReclamo);
  var analysisDraft = preservar ? _captureReclamoAnalysisDraft() : null;
  var data = await apiGet('/reclamos/' + id);
  if (!data) return;
  data = _normalizeReclamoDetail(data);
  _reclamoActual = data;
  _renderReclamoDetail(data);
  if (analysisDraft) _restoreReclamoAnalysisDraft(analysisDraft);
  _updateRecNavButtons();
}

function _updateRecNavButtons() {
  var btnPrev = document.getElementById('recNavPrev');
  var btnNext = document.getElementById('recNavNext');
  var label = document.getElementById('recNavLabel');
  if (!btnPrev || !btnNext) return;
  var id = _reclamoActual ? _reclamoActual.id : null;
  var idx = _reclamosListaIds.indexOf(id);
  btnPrev.disabled = (idx < 0 || idx >= _reclamosListaIds.length - 1);
  btnNext.disabled = (idx <= 0);
  if (label) label.textContent = (idx >= 0) ? (_reclamosListaIds.length - idx) + '/' + _reclamosListaIds.length : '';
}

function recNavPrevReclamo() {
  if (!_reclamoActual) return;
  var idx = _reclamosListaIds.indexOf(_reclamoActual.id);
  if (idx >= 0 && idx < _reclamosListaIds.length - 1) verReclamo(_reclamosListaIds[idx + 1]);
}

function recNavNextReclamo() {
  if (!_reclamoActual) return;
  var idx = _reclamosListaIds.indexOf(_reclamoActual.id);
  if (idx > 0) verReclamo(_reclamosListaIds[idx - 1]);
}

// ---- Render Helpers ----

function renderAcciones(acciones) {
  var container = document.getElementById('recAccionesList');
  if (!acciones || acciones.length === 0) {
    container.innerHTML = '<div class="muted">Sin acciones registradas</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%; border-collapse:collapse;">' +
    '<tr style="background:#fff8e1; text-align:left;">' +
    '<th style="padding:4px 6px;">Tipo</th><th style="padding:4px 6px;">Descripción</th>' +
    '<th style="padding:4px 6px;">Responsable</th><th style="padding:4px 6px;">F. Prevista</th>' +
    '<th style="padding:4px 6px;">Estado</th><th style="padding:4px 4px;"></th></tr>' +
    acciones.map(function(a) {
      var tColor = _recAccionTipoColors[a.tipo] || '#666';
      var eLabel = a.estado === 'completada' ? '✅' : a.estado === 'en_proceso' ? '🔄' : '⏳';
      var canDeleteAction = typeof a.id === 'number';
      return '<tr style="border-bottom:1px solid #ffe0b2;">' +
        '<td style="padding:3px 6px;"><span style="color:' + tColor + '; font-weight:600; text-transform:capitalize; font-size:11px;">' + a.tipo + '</span></td>' +
        '<td style="padding:3px 6px;">' + a.descripcion + '</td>' +
        '<td style="padding:3px 6px; font-size:11px;">' + (a.responsable || '-') + '</td>' +
        '<td style="padding:3px 6px; font-size:11px;">' + (a.fecha_prevista || '-') + '</td>' +
        '<td style="padding:3px 6px; font-size:11px;">' + eLabel + ' ' + a.estado + '</td>' +
        '<td style="padding:3px 4px;">' + (canDeleteAction ? '<button class="secondary" style="font-size:10px; padding:1px 5px; color:#b42318;" onclick="eliminarAccion(' + a.id + ')">✕</button>' : '') + '</td>' +
        '</tr>';
    }).join('') +
    '</table>';
}

function renderImagenesEnContainer(containerId, imagenes) {
  var container = document.getElementById(containerId);
  if (!container) return;
  if (!imagenes || imagenes.length === 0) {
    container.innerHTML = '<div class="muted">Sin imágenes</div>';
    return;
  }
  container.innerHTML = '';
  imagenes.forEach(function(img, idx) {
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative; width:120px; border:1px solid #ccc; border-radius:6px; overflow:hidden; background:#f9f9f9; cursor:pointer;';

    var thumb = document.createElement('img');
    thumb.src = img.url;
    thumb.style.cssText = 'width:120px; height:90px; object-fit:cover; display:block;';
    thumb.title = img.filename;
    wrapper.appendChild(thumb);

    // Click opens modal viewer (same as Presentaciones)
    wrapper.onclick = function(e) {
      // Don't open viewer if delete button was clicked
      if (e.target.tagName === 'BUTTON') return;
      if (typeof openImageViewer === 'function') {
        openImageViewer(imagenes, idx);
      }
    };

    var label = document.createElement('div');
    label.style.cssText = 'padding:2px 4px; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    label.textContent = img.filename;
    wrapper.appendChild(label);

    var btn = document.createElement('button');
    btn.className = 'secondary';
    btn.style.cssText = 'position:absolute; top:2px; right:2px; font-size:10px; padding:0 4px; background:rgba(255,255,255,0.8); color:#b42318; border-radius:3px;';
    btn.textContent = '✕';
    btn.onclick = function(e) { e.stopPropagation(); eliminarImagen(img.id); };
    wrapper.appendChild(btn);

    container.appendChild(wrapper);
  });
}

function renderReclamoTimeline(seguimientos) {
  var container = document.getElementById('recTimeline');
  if (!seguimientos || seguimientos.length === 0) {
    container.innerHTML = '<div class="muted">Sin seguimientos</div>';
    return;
  }
  container.innerHTML = seguimientos.map(function(s) {
    var fecha = formatDateTime(s.fecha, '');
    var estadoChange = '';
    if (s.estado_nuevo) {
      var fromLabel = _recEstadoLabels[s.estado_anterior] || s.estado_anterior || '?';
      var toLabel = _recEstadoLabels[s.estado_nuevo] || s.estado_nuevo;
      var toColor = _recEstadoColors[s.estado_nuevo] || '#666';
      estadoChange = ' <span style="background:' + toColor + '; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px;">' + fromLabel + ' → ' + toLabel + '</span>';
    }
    return '<div style="padding:6px 0; border-bottom:1px solid #f0f0f0;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<span style="font-weight:500;">' + s.usuario + '</span>' +
      '<span class="muted" style="font-size:10px;">' + fecha + '</span>' +
      '</div>' +
      '<div style="margin-top:2px;">' + (s.comentario || '') + estadoChange + '</div>' +
      '</div>';
  }).join('');
}

// ---- Estado & Aplica ----

async function cerrarReclamo() {
  if (!_reclamoActual) return;

  var aplicaSelect = document.getElementById('recDetailAplica');
  var aplicaValue = aplicaSelect ? aplicaSelect.value : _reclamoActual.aplica;
  var esAdmin = (currentRole === 'admin' || currentRole === 'admin_calidad');
  // Dos flujos:
  //   A) Cubicación: cubicador/externo → en_revision (lo revisa el jefe de servicio)
  //   B) Otra área:  responsable → validacion directo (el jefe del área responde por su análisis)
  // Heurística "es Cubicación": área aplica empieza con "Cubicac" (tolera singular/plural) o hay cubicador asignado.
  var area = (_reclamoActual.area_aplica || '').toLowerCase();
  var esCubicacion = (area.indexOf('cubicac') === 0) || !!_reclamoActual.cubicador_asignado;
  var estadoDestino = esAdmin ? 'validacion' : (esCubicacion ? 'en_revision' : 'validacion');

  if (!aplicaValue || aplicaValue === 'pendiente') {
    alert('Primero debe seleccionar "Sí aplica" o "No aplica".');
    return;
  }

  var justificacion = (document.getElementById('recDetailRespuestaTexto').value || '').trim();
  if (!justificacion) {
    alert('Debe ingresar la explicación/justificación del análisis.');
    document.getElementById('recDetailRespuestaTexto').focus();
    return;
  }

  var detail = await apiGet('/reclamos/' + _reclamoActual.id + '?include_images=false');
  if (!detail) return;
  if ((detail.acciones || []).length === 0) {
    alert('Debe registrar al menos una acción antes de continuar.');
    return;
  }

  var msg = estadoDestino === 'en_revision'
    ? '¿Enviar este reclamo a revisión?\n\nEl Jefe de Servicio lo revisará antes de pasar a Calidad.'
    : '¿Enviar este reclamo a validación?';
  if (!confirm(msg)) return;

  // Enviar el análisis del formulario JUNTO con el cambio de estado, para que el
  // backend valide y persista lo que el usuario ve en pantalla (sin exigir un
  // "Guardar análisis" previo). PATCH no destructivo: solo campos con valor.
  var body = { estado: estadoDestino };
  var _setIf = function(k, v) { if (v !== '' && v != null && !(typeof v === 'number' && isNaN(v))) body[k] = v; };
  _setIf('aplica', aplicaValue);
  _setIf('respuesta_texto', justificacion);
  _setIf('categoria_ishikawa', document.getElementById('recDetailCategoria').value);
  _setIf('sub_causa', document.getElementById('recDetailSubCausa').value);
  _setIf('cod_causa', document.getElementById('recDetailCodCausa').value);
  _setIf('area_aplica', document.getElementById('recDetailAreaAplica').value);
  _setIf('fecha_analisis', document.getElementById('recDetailFechaAnalisis').value);
  _setIf('kilos_mal_fabricados', parseFloat(document.getElementById('recDetailKilosMal').value));
  _setIf('tiempo_respuesta', parseInt(document.getElementById('recTiempoRespuestaAnalisis').value));
  if (body.tiempo_respuesta != null) {
    body.tiempo_respuesta_unidad = document.getElementById('recTiempoRespuestaUnidadAnalisis').value || 'horas';
  }

  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    await verReclamo(_reclamoActual.id);
    await loadReclamos();
    await loadRecLanding();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

// Refresca el contexto tras una acción de flujo desde el modal.
// Si venimos del sub-tab Validaciones, cierra el modal y refresca la cola;
// si no, recarga el detalle.
async function _refrescarTrasAccionFlujo() {
  var enSubValidaciones = document.getElementById('recSubValidaciones') &&
                          document.getElementById('recSubValidaciones').style.display !== 'none';
  if (enSubValidaciones) {
    if (typeof closeReclamoModal === 'function') closeReclamoModal();
    if (typeof loadRecValidaciones === 'function') await loadRecValidaciones();
  } else {
    await verReclamo(_reclamoActual.id);
  }
  await loadReclamos();
  await loadRecLanding();
}

// Sección ÁMBAR (revisión, Jefe de Servicio). Un solo campo de explicación en
// pantalla (recRevisionComentario), obligatorio tanto al aprobar como al devolver.
// Sin prompt(): el motivo es el comentario que ya está a la vista.
async function aprobarParaValidacion() {
  if (!_reclamoActual) return;
  var comentEl = document.getElementById('recRevisionComentario');
  var comentario = comentEl ? (comentEl.value || '').trim() : '';
  if (!comentario) { alert('Indica la explicación de la aprobación en el campo de comentario.'); if (comentEl) comentEl.focus(); return; }
  if (!confirm('¿Aprobar este reclamo para validación de Calidad?')) return;
  var body = { estado: 'validacion', revision_observaciones: comentario };
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { if (comentEl) comentEl.value = ''; await _refrescarTrasAccionFlujo(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function devolverRevisionDesdeModal() {
  if (!_reclamoActual) return;
  var comentEl = document.getElementById('recRevisionComentario');
  var motivo = comentEl ? (comentEl.value || '').trim() : '';
  if (!motivo) { alert('Indica el motivo de la devolución en el campo de comentario.'); if (comentEl) comentEl.focus(); return; }
  if (!confirm('¿Devolver el reclamo? Vuelve a "En análisis" para corregir.')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'en_analisis', revision_observaciones: motivo })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { if (comentEl) comentEl.value = ''; await _refrescarTrasAccionFlujo(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function reabrirReclamo() {
  if (!_reclamoActual) return;
  if (!confirm('¿Reabrir este reclamo?\n\nEl estado volverá a "En análisis" y se limpiará la validación.')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'en_analisis', validacion_resultado: '', validacion_observaciones: '' })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    await verReclamo(_reclamoActual.id);
    await loadReclamos();
    await loadRecLanding();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
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
    _setIf('area_aplica', document.getElementById('recDetailAreaAplica').value);
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

// ---- Validación ----
// Sección VERDE (Validación Calidad). Misma lógica que la ámbar: dos acciones
// limpias — Aprobar (cierra el reclamo) o Devolver (vuelve a revisión del Jefe
// de Servicio). El comentario es opcional y queda en el seguimiento.
async function aprobarValidacionDesdeModal() {
  if (!_reclamoActual) return;
  var msg = document.getElementById('recValidacionMsg');
  var comentEl = document.getElementById('recValidacionComentario');
  var comentario = comentEl ? (comentEl.value || '').trim() : '';
  if (!comentario) { alert('Indica la explicación de la aprobación en el campo de comentario.'); if (comentEl) comentEl.focus(); return; }
  if (!confirm('¿Aprobar la validación? El reclamo quedará cerrado.')) return;
  if (msg) { msg.textContent = 'Guardando...'; msg.style.color = '#666'; }
  // validacion_resultado 'aprobado' dispara el cierre automático en el backend.
  var body = { validacion_resultado: 'aprobado', validacion_observaciones: comentario };
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    if (comentEl) comentEl.value = '';
    await _refrescarTrasAccionFlujo();
  } else if (msg) {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function devolverValidacionDesdeModal() {
  if (!_reclamoActual) return;
  var comentEl = document.getElementById('recValidacionComentario');
  var motivo = comentEl ? (comentEl.value || '').trim() : '';
  if (!motivo) { alert('Indica el motivo de la devolución en el campo de comentario.'); if (comentEl) comentEl.focus(); return; }
  if (!confirm('¿Devolver el reclamo? Vuelve a "En revisión" del Jefe de Servicio.')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'en_revision', revision_observaciones: motivo })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { if (comentEl) comentEl.value = ''; await _refrescarTrasAccionFlujo(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// ---- Acciones ----
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
