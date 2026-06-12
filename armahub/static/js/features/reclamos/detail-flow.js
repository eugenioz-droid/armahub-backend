// ArmaHub Reclamos — Detail View: Flujo y navegación (Fase 3 del refactor)
// Navegación del modal (abrir reclamo, prev/next) y acciones de flujo de estado
// (enviar a revisión/validación, aprobar/devolver en revisión y validación,
// reabrir). Genérico: el flujo es el mismo para cualquier listado.
//
// Dependencias (file-scope global): _reclamoActual, _reclamosListaIds (constants.js);
// _captureReclamoAnalysisDraft/_restoreReclamoAnalysisDraft/_renderReclamoDetail
// (detail-render.js); _normalizeReclamoDetail (helpers.js); loadReclamos
// (list.js); loadRecLanding/loadRecValidaciones/closeReclamoModal (dashboards.js);
// currentRole (global).

// ---- Navegación del modal ----

async function verReclamo(id, options) {
  options = options || {};
  // Preservar el borrador de análisis SIEMPRE que recarguemos el mismo reclamo
  // que ya está abierto (cambio de estado, agregar acción, cambiar aplica, etc.).
  // Así no se pierde lo que el usuario está escribiendo. Solo se descarta al
  // navegar a OTRO reclamo (id distinto) o si se pide explícitamente lo contrario.
  var esMismoReclamo = _reclamoActual && String(_reclamoActual.id) === String(id);
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

// ---- Acciones de flujo de estado ----

async function cerrarReclamo() {
  if (!_reclamoActual) return;

  var aplicaSelect = document.getElementById('recDetailAplica');
  var aplicaValue = aplicaSelect ? aplicaSelect.value : _reclamoActual.aplica;
  // FASE C: el destino (en_revision vs validacion) lo decide el BACKEND según el
  // flag tiene_revision del área del reclamo. El front solo pide "enviar adelante"
  // mandando estado='validacion'; si el área tiene revisión, el backend lo
  // reescribe a 'en_revision'. Sin heurística de texto en el cliente.
  var estadoDestino = 'validacion';

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

  // El área del reclamo puede tener etapa de revisión; el backend lo resuelve.
  if (!confirm('¿Enviar este reclamo para su validación?\n\nSi el área tiene etapa de revisión, primero pasará por el Jefe de Servicio.')) return;

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

// Sección VERDE (validación, Calidad). Mismo patrón que la ámbar: explicación
// obligatoria en recValidacionComentario para aprobar o devolver.
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
