// ArmaHub Reclamos — Detail View: Render (Fase 1 del refactor de detail.js)
// Render de la ficha del reclamo en el modal + captura/restauración del borrador
// de análisis. Genérico: sirve a cualquier listado (Clientes, Internos).
//
// Dependencias (file-scope global, cargadas antes por constants.js/helpers.js):
//   _reclamoActual, _recEstadoLabels/_recEstadoColors, _recAplicaLabels/_recAplicaColors,
//   _recIshikawaLabels, _formatCorrelativoCalidad, _updateAplicaBadge,
//   renderAcciones, renderImagenesEnContainer, renderReclamoTimeline,
//   _applyReclamoDetailPermissions (detail-permissions.js), openReclamoModal (detail.js).

function _populateReclamoDetailSelectors(data) {
  document.getElementById('recDetailAplica').value = data.aplica || 'pendiente';
  var anioField = document.getElementById('recDetailAnioCalidad');
  if (anioField) anioField.value = data.anio_calidad || '';
  var numField = document.getElementById('recDetailNumeroCalidad');
  if (numField) numField.value = data.numero_calidad || '';

  var srcSel = document.getElementById('recProyecto');
  var detSel = document.getElementById('recDetailProyecto');
  if (srcSel && detSel) {
    detSel.innerHTML = srcSel.innerHTML;
    detSel.value = data.id_proyecto || '';
  }

  var detAsignado = document.getElementById('recDetailAsignadoA');
  if (detAsignado) detAsignado.value = data.asignado_a || '';
}

function _renderReclamoHeader(data) {
  var corrCal = _formatCorrelativoCalidad(data);
  var titlePrefix = corrCal ? corrCal + ' — ' : (data.correlativo ? data.correlativo + ' — ' : '#' + data.id + ' — ');
  document.getElementById('recDetailTitle').textContent = titlePrefix + data.titulo;

  var metaParts = [];
  if (data.correlativo && corrCal) metaParts.push(data.correlativo);
  if (data.nombre_proyecto) metaParts.push('Proyecto: ' + data.nombre_proyecto);
  metaParts.push('Creado por: ' + data.creado_por);
  if (data.fecha_creacion) metaParts.push(formatDateTime(data.fecha_creacion, ''));
  if (data.responsable) metaParts.push('Cub. Responsable: ' + data.responsable);
  if (data.detectado_por) metaParts.push('Detectado por: ' + data.detectado_por);
  if (data.asignado_a) metaParts.push('USC Responsable: ' + data.asignado_a);
  if (data.cubicador_asignado) metaParts.push('Cub. email: ' + data.cubicador_asignado);
  document.getElementById('recDetailMeta').textContent = metaParts.join(' · ');

  var estadoDisplay = document.getElementById('recDetailEstadoDisplay');
  var estadoLabel = _recEstadoLabels[data.estado] || data.estado;
  var estadoColor = _recEstadoColors[data.estado] || '#666';
  estadoDisplay.innerHTML = '<span style="background:' + estadoColor + '; color:#fff; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:600;">' + estadoLabel + '</span>';
}

function _renderReclamoAntecedentes(data) {
  var info = document.getElementById('recDetailInfo');
  var tipoLabel = data.tipo_reclamo === 'faltante' ? 'Faltante' : 'Error';
  var tipoColor = data.tipo_reclamo === 'faltante' ? '#ff9800' : '#e53935';
  var infoHtml = '<div class="row" style="gap:16px; flex-wrap:wrap;">';
  infoHtml += '<div><strong>Categoría:</strong> <span style="color:' + tipoColor + '; font-weight:600;">' + tipoLabel + '</span></div>';
  infoHtml += '<div><strong>Estado:</strong> <span style="color:' + (_recEstadoColors[data.estado] || '#666') + '; font-weight:600;">' + (_recEstadoLabels[data.estado] || data.estado) + '</span></div>';
  var aplColor = _recAplicaColors[data.aplica] || '#ff9800';
  infoHtml += '<div><strong>Aplica:</strong> <span style="color:' + aplColor + '; font-weight:600;">' + (_recAplicaLabels[data.aplica] || 'Pendiente') + '</span></div>';
  if (data.detectado_por) infoHtml += '<div><strong>Detectado por:</strong> ' + data.detectado_por + '</div>';
  if (data.responsable) infoHtml += '<div><strong>Responsable:</strong> ' + data.responsable + '</div>';
  if (data.kilos_mal_fabricados != null) infoHtml += '<div><strong>Kilos mal fabricados:</strong> <span style="color:#b42318; font-weight:600;">' + formatKilos(data.kilos_mal_fabricados, 2, '0 kg') + '</span></div>';
  if (data.fecha_deteccion) infoHtml += '<div><strong>F. Detección:</strong> ' + formatDateShort(data.fecha_deteccion, '') + '</div>';
  if (data.fecha_cierre) infoHtml += '<div><strong>Cerrado:</strong> ' + formatDateTime(data.fecha_cierre, '') + '</div>';
  infoHtml += '</div>';
  if (data.descripcion) infoHtml += '<div style="margin-top:6px; white-space:pre-wrap;">' + data.descripcion + '</div>';
  info.innerHTML = infoHtml;
}

function _renderReclamoRespuesta(data) {
  document.getElementById('recDetailRespuestaTexto').value = data.respuesta_texto_display;
  document.getElementById('recDetailCausaDisplay').value = data.causa_display;
  document.getElementById('recDetailCategoria').value = data.categoria_ishikawa || '';
  document.getElementById('recDetailSubCausa').value = data.sub_causa || '';
  document.getElementById('recDetailCodCausa').value = data.cod_causa || '';
  document.getElementById('recDetailAreaAplica').value = data.area_aplica || 'Cubicación';
  document.getElementById('recDetailFechaAnalisis').value = data.fecha_analisis_input;
  document.getElementById('recDetailKilosMal').value = data.kilos_mal_fabricados != null ? data.kilos_mal_fabricados : '';
  document.getElementById('recTiempoRespuestaAnalisis').value = data.tiempo_respuesta || '';
  document.getElementById('recTiempoRespuestaUnidadAnalisis').value = data.tiempo_respuesta_unidad || 'horas';

  var respInfo = document.getElementById('recRespuestaInfo');
  if (data.respuesta_por) {
    respInfo.innerHTML = 'Respondido por: <strong>' + data.respuesta_por + '</strong>' +
      (data.respuesta_fecha ? ' — ' + formatDateTime(data.respuesta_fecha, '') : '');
  } else {
    respInfo.textContent = 'Sin respuesta aún';
  }
  document.getElementById('recRespMsg').textContent = '';

  var cubNombreEl = document.getElementById('recDetailCubicadorNombre');
  if (cubNombreEl) {
    var cubName = data.responsable || 'Sin asignar';
    cubNombreEl.textContent = cubName;
    cubNombreEl.style.color = data.responsable ? '#1565C0' : '#999';
  }
  _updateAplicaBadge();
}

function _renderReclamoValidacion(data) {
  // La sección verde tiene solo un comentario opcional (parte en blanco) y
  // dos acciones. El mensaje de estado se limpia al reabrir el modal.
  var msg = document.getElementById('recValidacionMsg');
  if (msg) msg.textContent = '';
  var coment = document.getElementById('recValidacionComentario');
  if (coment) coment.value = '';
}

function _renderReclamoActionsSection(data) {
  renderAcciones(data.acciones_normalized);
}

function _renderReclamoImagesSection(data) {
  renderImagenesEnContainer('recImagenesAntecedentes', data.imagenes_antecedentes);
  renderImagenesEnContainer('recImagenesRespuesta', data.imagenes_respuesta);
}

function _renderReclamoTimelineSection(data) {
  renderReclamoTimeline(data.seguimientos || []);
}

function _resetReclamoSeguimientoForm() {
  document.getElementById('recSeguimientoComentario').value = '';
  document.getElementById('recSeguimientoEstado').value = '';
  document.getElementById('recSeguimientoMsg').textContent = '';
}

function _renderReclamoAssets(data) {
  _renderReclamoActionsSection(data);
  _renderReclamoImagesSection(data);
  _renderReclamoTimelineSection(data);
  _resetReclamoSeguimientoForm();
}

function _renderReclamoDetail(data) {
  var card = document.getElementById('reclamoDetailCard');
  card.style.display = '';
  document.getElementById('recEditForm').style.display = 'none';
  document.getElementById('recDetailInfo').style.display = '';
  document.getElementById('btnEditarReclamo').textContent = '✏️ Editar';
  _populateReclamoDetailSelectors(data);
  _renderReclamoHeader(data);
  _renderReclamoAntecedentes(data);
  _renderReclamoRespuesta(data);
  _renderReclamoValidacion(data);
  _renderReclamoAssets(data);
  _applyReclamoDetailPermissions(data);
  openReclamoModal(card);
  card.scrollTop = 0;
}

function _captureReclamoAnalysisDraft() {
  var fieldIds = [
    'recDetailRespuestaTexto',
    'recDetailCausaDisplay',
    'recDetailCategoria',
    'recDetailSubCausa',
    'recDetailCodCausa',
    'recDetailAreaAplica',
    'recDetailFechaAnalisis',
    'recDetailKilosMal',
    'recTiempoRespuestaAnalisis',
    'recTiempoRespuestaUnidadAnalisis'
  ];
  var draft = {};
  var hasValue = false;
  fieldIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    draft[id] = el.value;
    if (el.value !== '') hasValue = true;
  });
  return hasValue ? draft : null;
}

function _restoreReclamoAnalysisDraft(draft) {
  if (!draft) return;
  Object.keys(draft).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = draft[id];
  });
}
