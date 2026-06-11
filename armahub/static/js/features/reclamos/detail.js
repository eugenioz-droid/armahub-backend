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
  // Estos campos viven en el sub-tab Validaciones; solo rellenar si están en DOM
  var valRes = document.getElementById('recDetailValidacionResultado');
  var valObs = document.getElementById('recDetailValidacionObs');
  var valTime = document.getElementById('recTiempoRespuesta');
  var valTimeU = document.getElementById('recTiempoRespuestaUnidad');
  if (valRes) valRes.value = data.validacion_resultado || '';
  if (valObs) valObs.value = data.validacion_observaciones || '';
  if (valTime) valTime.value = data.tiempo_respuesta || '';
  if (valTimeU) valTimeU.value = data.tiempo_respuesta_unidad || 'horas';

  var valInfo = document.getElementById('recValidacionInfo');
  if (data.validacion_por) {
    var valLabel = { aprobado: '✅ Aprobado', rechazado: '❌ Rechazado', corregido: '✏️ Corregido' }[data.validacion_resultado] || data.validacion_resultado;
    var tiempoInfo = '';
    if (data.tiempo_respuesta && data.tiempo_respuesta > 0) {
      var unidadLabel = { minutos: 'min', horas: 'hrs', dias: 'días' }[data.tiempo_respuesta_unidad] || 'hrs';
      tiempoInfo = ' — ⏱️ Tiempo respuesta: <strong>' + data.tiempo_respuesta + ' ' + unidadLabel + '</strong>';
      if (data.tiempo_respuesta_actualizado_por) {
        tiempoInfo += ' (por ' + data.tiempo_respuesta_actualizado_por + ')';
      }
    }
    valInfo.innerHTML = 'Validado por: <strong>' + data.validacion_por + '</strong>' +
      (data.validacion_fecha ? ' — ' + formatDateTime(data.validacion_fecha, '') : '') +
      ' — Resultado: <strong>' + valLabel + '</strong>' +
      tiempoInfo;
  } else {
    valInfo.textContent = 'Sin validación aún';
  }
  document.getElementById('recValidacionMsg').textContent = '';
}

function _renderReclamoActionsSection(data) {
  renderAcciones(data.acciones_normalized);
}

function _renderReclamoImagesSection(data) {
  console.log('[verReclamo] detalle normalizado:', {
    respuesta_texto: data.respuesta_texto,
    explicacion_causa: data.explicacion_causa,
    fecha_analisis: data.fecha_analisis,
    acciones: data.acciones_normalized.length,
    imagenes_antecedentes: data.imagenes_antecedentes.length,
    imagenes_respuesta: data.imagenes_respuesta.length
  });

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

function _applyReclamoDetailPermissions(data) {
  var esCreador = data.creado_por && data.creado_por === currentUserEmail;
  var esPropioCub = data.cubicador_asignado === currentUserEmail || data.respuesta_por === currentUserEmail;
  var validado = !!data.validacion_resultado;
  var estadoPermiteAnalisis = data.estado === 'abierto' || data.estado === 'en_analisis';

  var puedeEditarSec1 = (currentRole === 'admin' || currentRole === 'admin_calidad') || (currentRole === 'usc' && esCreador && data.estado === 'abierto');
  if (validado && currentRole !== 'admin') puedeEditarSec1 = false;
  var btnEditar = document.getElementById('btnEditarReclamo');
  if (btnEditar) btnEditar.style.display = puedeEditarSec1 ? '' : 'none';

  var selAplica = document.getElementById('recDetailAplica');
  var puedeCambiarAplica =
    (currentRole === 'admin' || currentRole === 'admin_calidad') ||
    ((currentRole === 'cubicador' || currentRole === 'externo') && esPropioCub && estadoPermiteAnalisis);
  if (selAplica) selAplica.disabled = !puedeCambiarAplica;

  var puedeEliminar = (currentRole === 'admin' || currentRole === 'admin_calidad') || (currentRole === 'usc' && esCreador);
  var btnElim = document.getElementById('btnEliminarReclamo');
  if (btnElim) btnElim.style.display = puedeEliminar ? '' : 'none';

  // Botones de flujo: "Enviar a revisión" (cubicador), "Aprobar para validación" (admin)
  var esAsignado = (['cubicador','externo'].includes(currentRole) && esPropioCub);
  var estadoEnAnalisis = (data.estado === 'en_analisis');
  var estadoEnRevision = (data.estado === 'en_revision');
  var estaCerrado = (data.estado === 'cerrado' || data.estado === 'rechazado');
  var puedeReabrir = estaCerrado && (currentRole === 'admin' || currentRole === 'admin_calidad');

  // Cubicador/externo: ve "Enviar a revisión" solo si el reclamo está en análisis
  var puedeEnviarARevision = esAsignado && estadoEnAnalisis;
  // Admin: ve "Aprobar para validación" cuando el reclamo está en revisión
  var puedeAprobarParaVal = (currentRole === 'admin') && estadoEnRevision;
  // Admin/admin_calidad: acceso total al container también si aun en análisis
  var puedeAdmin = (currentRole === 'admin' || currentRole === 'admin_calidad');

  var cerrarCont = document.getElementById('recCerrarContainer');
  if (cerrarCont) cerrarCont.style.display = (puedeEnviarARevision || puedeAprobarParaVal || (puedeAdmin && !estaCerrado)) ? '' : 'none';

  var btnCerrar = document.getElementById('btnCerrarReclamo');
  var btnAprobar = document.getElementById('btnAprobarParaValidacion');
  var btnReabrir = document.getElementById('btnReabrirReclamo');
  // "Enviar a revisión": cubicador en estado en_analisis; admin en estado en_analisis (envía directo a validacion)
  if (btnCerrar) {
    if (puedeAdmin && estadoEnAnalisis) {
      btnCerrar.style.display = '';
      btnCerrar.textContent = '📤 Enviar a validación';
    } else if (puedeEnviarARevision) {
      btnCerrar.style.display = '';
      btnCerrar.textContent = '📤 Enviar a revisión';
    } else {
      btnCerrar.style.display = 'none';
    }
  }
  if (btnAprobar) btnAprobar.style.display = puedeAprobarParaVal ? '' : 'none';
  if (btnReabrir) btnReabrir.style.display = puedeReabrir ? '' : 'none';

  var anioCalField = document.getElementById('recDetailAnioCalidad');
  if (anioCalField) anioCalField.disabled = !(currentRole === 'admin' || currentRole === 'admin_calidad');
  var numCalField = document.getElementById('recDetailNumeroCalidad');
  if (numCalField) numCalField.disabled = !puedeEditarSec1;

  var detProySel = document.getElementById('recDetailProyecto');
  if (detProySel) detProySel.disabled = !(currentRole === 'admin' || currentRole === 'admin_calidad');

  var detAsigSel = document.getElementById('recDetailAsignadoA');
  if (detAsigSel) detAsigSel.disabled = !(currentRole === 'admin' || currentRole === 'admin_calidad');

  var puedeResponder = ['admin','admin_calidad','cubicador','externo'].includes(currentRole);
  if ((['cubicador','externo'].includes(currentRole)) && !esPropioCub) puedeResponder = false;
  if (!estadoPermiteAnalisis && !['admin','admin_calidad'].includes(currentRole)) puedeResponder = false;
  if (validado && currentRole !== 'admin') puedeResponder = false;
  var sec2Fields = ['recDetailRespuestaTexto','recDetailCausaDisplay','recDetailAreaAplica','recDetailFechaAnalisis','recDetailKilosMal','recTiempoRespuestaAnalisis','recTiempoRespuestaUnidadAnalisis'];
  sec2Fields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeResponder; });
  var btnGuardarResp = document.getElementById('btnGuardarRespuesta');
  if (btnGuardarResp) btnGuardarResp.style.display = puedeResponder ? '' : 'none';
  var btnClearCausa = document.getElementById('recBtnClearCausa');
  if (btnClearCausa) btnClearCausa.style.display = puedeResponder ? '' : 'none';
  var respDropZone = document.getElementById('recRespDropZone');
  var respFileInput = document.getElementById('recRespFileInput');
  if (respDropZone) respDropZone.style.display = puedeResponder ? '' : 'none';
  if (respFileInput) respFileInput.disabled = !puedeResponder;

  var puedeValidar = (currentRole === 'admin_calidad');
  // Los campos de validación viven ahora en el sub-tab Validaciones; nada que ocultar aquí.

  var puedeAccion = ['admin','admin_calidad','cubicador','externo'].includes(currentRole);
  if ((['cubicador','externo'].includes(currentRole)) && !esPropioCub) puedeAccion = false;
  if (!estadoPermiteAnalisis && !['admin','admin_calidad'].includes(currentRole)) puedeAccion = false;
  if (validado && currentRole !== 'admin') puedeAccion = false;
  var accionFields = ['recNuevaAccionTipo','recNuevaAccionDesc','recNuevaAccionResp','recNuevaAccionFecha'];
  accionFields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeAccion; });

  // Imágenes de registro: solo admin/admin_calidad/usc
  var puedeImgRegistro = ['admin','admin_calidad','usc'].includes(currentRole);
  var detDropZone = document.getElementById('recDetailDropZone');
  var detFileInput = document.getElementById('recDetailFileInput');
  if (detDropZone) detDropZone.style.display = puedeImgRegistro ? '' : 'none';
  if (detFileInput) detFileInput.disabled = !puedeImgRegistro;

  // PDF export: admin, admin_calidad, cubicador (propios), usc
  var puedePdf = ['admin','admin_calidad'].includes(currentRole) || (currentRole === 'usc') || (currentRole === 'cubicador' && esPropioCub);
  var btnPdf = document.getElementById('btnPdfReclamo');
  if (btnPdf) btnPdf.style.display = puedePdf ? '' : 'none';

  // Email placeholder: admin, admin_calidad only
  var btnEnviar = document.getElementById('btnEnviarReclamo');
  if (btnEnviar) btnEnviar.style.display = ['admin','admin_calidad'].includes(currentRole) ? '' : 'none';
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

async function verReclamo(id, options) {
  options = options || {};
  var analysisDraft = options.preserveAnalysisDraft ? _captureReclamoAnalysisDraft() : null;
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
  // Destino: admin envía a validacion, cubicador/externo envía a en_revision (Flujo A) o validacion (Flujo B)
  var esCubicacion = (_reclamoActual.area_aplica === 'Cubicaciones' || _reclamoActual.cubicador_asignado);
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

  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: estadoDestino })
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

async function aprobarParaValidacion() {
  if (!_reclamoActual) return;
  if (!confirm('¿Aprobar este reclamo para validación de Calidad?')) return;
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'validacion' })
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
    // Debug: Get all field values
    var respuestaTexto = document.getElementById('recDetailRespuestaTexto').value.trim() || null;
    console.log('[guardarRespuesta] respuestaTexto value:', respuestaTexto);
    console.log('[guardarRespuesta] respuestaTexto length:', respuestaTexto ? respuestaTexto.length : 0);
    
    var body = {
      respuesta_texto: respuestaTexto,
      categoria_ishikawa: document.getElementById('recDetailCategoria').value || null,
      sub_causa: document.getElementById('recDetailSubCausa').value || null,
      cod_causa: document.getElementById('recDetailCodCausa').value || null,
      area_aplica: document.getElementById('recDetailAreaAplica').value || null,
      fecha_analisis: document.getElementById('recDetailFechaAnalisis').value || null,
      kilos_mal_fabricados: parseFloat(document.getElementById('recDetailKilosMal').value) || null,
      tiempo_respuesta: parseInt(document.getElementById('recTiempoRespuestaAnalisis').value) || null,
      tiempo_respuesta_unidad: document.getElementById('recTiempoRespuestaUnidadAnalisis').value || 'horas'
    };
    // Auto-change state to "en_analisis" if current state is "abierto"
    if (_reclamoActual.estado === 'abierto') {
      body.estado = 'en_analisis';
    }
    console.log('[guardarRespuesta] Enviando PATCH body:', JSON.stringify(body));
    var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log('[guardarRespuesta] Response status:', res.status);
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    console.log('[guardarRespuesta] Response data:', JSON.stringify(data));
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
async function guardarValidacion() {
  if (!_reclamoActual) return;
  var msg = document.getElementById('recValidacionMsg');
  var resultado = document.getElementById('recDetailValidacionResultado').value;
  var obs = document.getElementById('recDetailValidacionObs').value.trim();
  
  // Capturar tiempo de respuesta
  var tiempoRespuesta = document.getElementById('recTiempoRespuesta').value;
  var tiempoRespuestaUnidad = document.getElementById('recTiempoRespuestaUnidad').value;
  
  if (!resultado) { msg.textContent = 'Selecciona un resultado'; msg.style.color = '#b42318'; return; }
  
  // Confirmación antes de rechazar — el backend reabrirá el reclamo automáticamente
  if (resultado === 'rechazado') {
    if (!obs) { msg.textContent = 'Ingresa observaciones para el rechazo'; msg.style.color = '#b42318'; return; }
    if (!confirm('Se reabrirá el reclamo y será devuelto al cubicador para corrección.\n\nMotivo: ' + obs + '\n\n¿Continuar?')) return;
  }
  
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  
  var body = {
    validacion_resultado: resultado,
    validacion_observaciones: obs || null,
  };
  
  // Agregar tiempo de respuesta solo si tiene valor
  if (tiempoRespuesta && tiempoRespuesta > 0) {
    body.tiempo_respuesta = parseInt(tiempoRespuesta);
    body.tiempo_respuesta_unidad = tiempoRespuestaUnidad;
    body.tiempo_respuesta_actualizado_por = currentUserEmail;
    body.tiempo_respuesta_fecha_actualizacion = new Date().toISOString();
  }
  
  var res = await fetch(apiUrl('/reclamos/' + _reclamoActual.id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data;
  try { data = await res.json(); } catch(e) {
    var raw = '';
    try { raw = await res.clone().text(); } catch(_) {}
    console.error('[guardarValidacion] status=' + res.status, 'parse error', raw);
    msg.textContent = 'Error ' + res.status + ' (ver consola)'; msg.style.color = '#b42318';
    return;
  }
  if (data.ok) {
    if (resultado === 'rechazado') {
      msg.textContent = '❌ Rechazado — devuelto al cubicador para corrección';
    } else {
      msg.textContent = '✅ Validación guardada';
    }
    msg.style.color = resultado === 'rechazado' ? '#b42318' : '#558B2F';
    setTimeout(function() { msg.textContent = ''; }, 4000);
    await verReclamo(_reclamoActual.id);
    await loadReclamos(); await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
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
  // Debug: Check current respuesta text when selecting
  var respuestaText = document.getElementById('recDetailRespuestaTexto').value;
  console.log('[seleccionarIshikawa] Respuesta text BEFORE:', respuestaText);
  
  var parts = radio.value.split('|');
  _ishikawaSelection = { categoria: parts[0], cod_causa: parts[1], sub_causa: parts[2] };
  var catLabel = _recIshikawaLabels[parts[0]] || parts[0];
  document.getElementById('ishikawaSelectedDisplay').textContent = '[' + parts[1] + '] ' + catLabel + ' > ' + parts[2];
  
  // Debug: Check respuesta text after selection
  var respuestaTextAfter = document.getElementById('recDetailRespuestaTexto').value;
  console.log('[seleccionarIshikawa] Respuesta text AFTER:', respuestaTextAfter);
}

function confirmarIshikawa() {
  if (!_ishikawaSelection.categoria) { alert('Selecciona una causa primero'); return; }
  
  // Debug: Check current respuesta text before making changes
  var respuestaText = document.getElementById('recDetailRespuestaTexto').value;
  console.log('[confirmarIshikawa] Respuesta text BEFORE:', respuestaText);
  
  var displayText = '[' + _ishikawaSelection.cod_causa + '] ' + (_recIshikawaLabels[_ishikawaSelection.categoria] || '') + ' > ' + _ishikawaSelection.sub_causa;
  document.getElementById('recDetailCausaDisplay').value = displayText;
  document.getElementById('recDetailCategoria').value = _ishikawaSelection.categoria;
  document.getElementById('recDetailSubCausa').value = _ishikawaSelection.sub_causa;
  document.getElementById('recDetailCodCausa').value = _ishikawaSelection.cod_causa;
  
  // Debug: Check respuesta text after changes
  var respuestaTextAfter = document.getElementById('recDetailRespuestaTexto').value;
  console.log('[confirmarIshikawa] Respuesta text AFTER:', respuestaTextAfter);
  
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
