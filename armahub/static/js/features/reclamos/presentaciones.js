// ArmaHub Reclamos — Presentaciones
// Split from index.js (PC.17.4)

var _presData = null;
var _presChartPorPresentar = null;
var _presChartPresentados = null;
var _presColors = ['#7B1FA2','#1565C0','#e53935','#ff9800','#2e7d32','#00897B','#795548','#607D8B','#F44336','#009688'];

async function loadPresentaciones() {
  var data = await apiGet('/reclamos/para-presentar');
  if (!data) return;
  _presData = Object.assign({}, data, {
    reclamos: (data.data || data.reclamos || []).map(_normalizeReclamoListItem)
  });

  var sel = document.getElementById('presReclamoSelect');
  sel.innerHTML = '<option value="">— Seleccionar reclamo —</option>';
  (_presData.reclamos || []).forEach(function(r) {
    var badge = r.presentacion_realizada ? '✅ ' : '⏳ ';
    var opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = badge + (r.correlativo || '#' + r.id) + ' — ' + (r.titulo || '').substring(0, 50) + ' [' + r.cubicador_nombre + ']';
    sel.appendChild(opt);
  });

  var checkDiv = document.getElementById('presAsistentesCheckboxes');
  checkDiv.innerHTML = '';
  var addedEmails = {};
  if (currentUserEmail) {
    var meLabel = document.createElement('label');
    meLabel.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:12px; padding:2px 0; cursor:pointer;';
    var meName = currentUserName || currentUserEmail;
    meLabel.innerHTML = '<input type="checkbox" class="pres-asistente-cb" value="' + currentUserEmail + '" style="cursor:pointer;"> ' + meName + ' (yo)';
    checkDiv.appendChild(meLabel);
    addedEmails[currentUserEmail] = true;
  }
  (data.cubicadores || []).forEach(function(c) {
    if (addedEmails[c.email]) return;
    addedEmails[c.email] = true;
    var label = document.createElement('label');
    label.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:12px; padding:2px 0; cursor:pointer;';
    label.innerHTML = '<input type="checkbox" class="pres-asistente-cb" value="' + c.email + '" style="cursor:pointer;"> ' + c.nombre;
    checkDiv.appendChild(label);
  });

  document.getElementById('presAntecedentes').style.display = 'none';
  document.getElementById('presRegistroCard').style.display = 'none';
  loadPresStats();
}

function togglePresSection(sectionId) {
  var el = document.getElementById(sectionId);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function presNavPrev() {
  var sel = document.getElementById('presReclamoSelect');
  if (sel.selectedIndex > 1) { sel.selectedIndex--; seleccionarReclamoPres(); }
}

function presNavNext() {
  var sel = document.getElementById('presReclamoSelect');
  if (sel.selectedIndex < sel.options.length - 1) { sel.selectedIndex++; seleccionarReclamoPres(); }
}

function _renderPresentacionHeader(detail) {
  document.getElementById('presCorrelativo').textContent = detail.correlativo || '#' + detail.id;
  document.getElementById('presProyecto').textContent = detail.nombre_proyecto || '—';
  document.getElementById('presCubicador').textContent = detail.cubicador_nombre || '—';
  var estadoLabels = {abierto:'Abierto', en_analisis:'En análisis', validacion:'Validación', cerrado:'Cerrado', rechazado:'Rechazado'};
  document.getElementById('presEstado').textContent = estadoLabels[detail.estado] || detail.estado;
  var aplicaLabels = {si:'Sí aplica', no:'No aplica', pendiente:'Pendiente'};
  var aplicaEl = document.getElementById('presAplica');
  aplicaEl.textContent = aplicaLabels[detail.aplica] || 'Pendiente';
  aplicaEl.style.color = detail.aplica === 'si' ? '#2e7d32' : (detail.aplica === 'no' ? '#b42318' : '#e65100');
}

function _renderPresentacionRegistro(detail) {
  document.getElementById('presTitulo').textContent = detail.titulo || '—';
  document.getElementById('presTipo').textContent = detail.tipo_reclamo || '—';
  document.getElementById('presDetectado').textContent = detail.detectado_por || '—';
  document.getElementById('presFecha').textContent = detail.fecha_deteccion_input || '—';
  document.getElementById('presDescripcion').textContent = detail.descripcion || '—';
  document.getElementById('presResponsable').textContent = detail.responsable || '—';
  document.getElementById('presPrioridad').textContent = detail.prioridad || '—';
  document.getElementById('presIdCalidad').textContent = _formatCorrelativoCalidad(detail) || detail.id_calidad || '—';
  document.getElementById('presObservaciones').textContent = detail.observaciones || '—';
}

function _renderPresentacionAnalisis(detail) {
  console.log('[DEBUG] Datos formulario azul CORREGIDOS:', {
    explicacion_causa: detail.explicacion_causa,
    area_aplica: detail.area_aplica,
    respuesta_texto: detail.respuesta_texto,
    fecha_analisis: detail.fecha_analisis,
    respuesta_por: detail.respuesta_por,
    respuesta_fecha: detail.respuesta_fecha
  });

  document.getElementById('presIshikawa').textContent = detail.causa_display || '—';
  document.getElementById('presArea').textContent = detail.area_aplica || '—';
  document.getElementById('presRespuesta').textContent = detail.respuesta_texto_display || '—';
  document.getElementById('presFechaAnalisis').textContent = formatDateTime(detail.fecha_analisis, '—');
  document.getElementById('presRespondidoPor').textContent = detail.respuesta_por || '—';
  document.getElementById('presFechaRespuesta').textContent = formatDateTime(detail.respuesta_fecha, '—');
}

function _renderPresentacionAcciones(detail) {
  var accDiv = document.getElementById('presAcciones');
  accDiv.innerHTML = '';
  if (!detail.acciones_normalized || detail.acciones_normalized.length === 0) {
    return;
  }

  var tipoAccLabels = {inmediata:'Inmediata', correctiva:'Correctiva', preventiva:'Preventiva'};
  detail.acciones_normalized.forEach(function(a) {
    var row = document.createElement('div');
    row.style.cssText = 'padding:4px 6px; background:#fff; border-radius:4px; margin-bottom:3px; display:flex; gap:6px; align-items:center;';
    var badge = a.estado === 'completada' ? '✅' : '⏳';
    row.innerHTML = badge + ' <strong>' + (tipoAccLabels[a.tipo] || a.tipo) + ':</strong> ' +
      (a.descripcion || '') +
      (a.responsable ? ' <span style="color:#666;">(' + a.responsable + ')</span>' : '');
    accDiv.appendChild(row);
  });
}

function _renderPresentacionImagenes(detail) {
  var imgRecDiv = document.getElementById('presImagenesReclamo');
  var imgRespDiv = document.getElementById('presImagenesRespuesta');
  var imagenes = detail.imagenes || [];
  var imagenesRegistro = detail.imagenes_antecedentes || [];
  var imagenesAnalisis = detail.imagenes_respuesta || [];

  console.log('[DEBUG] Imágenes encontradas:', imagenes.map(function(img) {
    return { id: img.id, tipo: img.tipo, filename: img.filename, url: img.url };
  }));
  console.log('[DEBUG] ImágenesRegistro (rojo):', imagenesRegistro.length);
  console.log('[DEBUG] ImágenesAnalisis (azul):', imagenesAnalisis.length);

  if (imgRecDiv) imgRecDiv.innerHTML = '';
  if (imgRespDiv) imgRespDiv.innerHTML = '';

  setTimeout(function() {
    if (imagenesRegistro.length > 0) {
      imageRenderer.renderImageBar('presImagenesReclamo', imagenesRegistro, 'reclamo');
    } else if (imgRecDiv) {
      imgRecDiv.innerHTML = '<div style="padding:8px; text-align:center; color:#999; font-style:italic;">📷 Sin imágenes de registro</div>';
    }

    if (imagenesAnalisis.length > 0) {
      imageRenderer.renderImageBar('presImagenesRespuesta', imagenesAnalisis, 'respuesta');
    } else if (imgRespDiv) {
      imgRespDiv.innerHTML = '<div style="padding:8px; text-align:center; color:#999; font-style:italic;">📷 Sin imágenes de análisis</div>';
    }
  }, 200);
}

function _renderPresentacionEstado(detail) {
  var regCard = document.getElementById('presRegistroCard');
  var yaPres = document.getElementById('presYaPresentado');
  if (detail.presentacion_realizada) {
    yaPres.style.display = '';
    regCard.style.display = 'none';
    document.getElementById('presYaFecha').textContent = formatDateTime(detail.presentacion_fecha, '—');
    document.getElementById('presYaPor').textContent = detail.presentacion_por || '—';
    var asistEmails = (detail.presentacion_asistentes || '').split(',').filter(Boolean);
    var asistNames = asistEmails.map(function(e) {
      var found = (_presData.cubicadores || []).find(function(c) { return c.email === e; });
      return found ? found.nombre : e;
    });
    document.getElementById('presYaAsistentes').textContent = asistNames.join(', ') || '—';
    document.getElementById('presYaComentarios').textContent = detail.presentacion_comentarios || '—';
  } else {
    yaPres.style.display = 'none';
    regCard.style.display = '';
    document.querySelectorAll('.pres-asistente-cb').forEach(function(cb) { cb.checked = false; });
    document.getElementById('presComentarios').value = '';
    document.getElementById('presGuardarMsg').textContent = '';
  }
}

function _renderPresentacionDetail(detail) {
  document.getElementById('presAntecedentes').style.display = '';
  _renderPresentacionHeader(detail);
  _renderPresentacionRegistro(detail);
  _renderPresentacionAnalisis(detail);
  _renderPresentacionAcciones(detail);
  _renderPresentacionImagenes(detail);
  _renderPresentacionEstado(detail);
}

async function seleccionarReclamoPres() {
  var sel = document.getElementById('presReclamoSelect');
  var id = parseInt(sel.value);

  var antDiv = document.getElementById('presAntecedentes');
  var regCard = document.getElementById('presRegistroCard');

  if (!id || !_presData) {
    antDiv.style.display = 'none';
    regCard.style.display = 'none';
    return;
  }

  var rec = _presData.reclamos.find(function(r) { return r.id === id; });
  if (!rec) { antDiv.style.display = 'none'; regCard.style.display = 'none'; return; }

  var detail = await apiGet('/reclamos/' + id);
  if (!detail) return;
  detail = _adaptLegacyPresentacionRecord(rec, _normalizeReclamoDetail(detail));
  _renderPresentacionDetail(detail);
}

function getFileIcon(filename) {
  if (!filename) return '📄';
  var ext = filename.split('.').pop().toLowerCase();
  var iconMap = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    jpg: '📷', jpeg: '📷', png: '📷', gif: '📷', svg: '🖼️',
    mp4: '🎥', avi: '🎥', mov: '🎥', zip: '📦', rar: '📦'
  };
  return iconMap[ext] || '📄';
}

function getFileTypeBadge(contentType) {
  if (!contentType) return '';
  if (contentType.startsWith('image/')) return '📷';
  if (contentType === 'application/pdf') return '📄';
  if (contentType.includes('video/')) return '🎥';
  if (contentType.includes('zip') || contentType.includes('rar')) return '📦';
  return '📄';
}

// ---- ImageRenderer (used for presentaciones thumbnails) ----
class ImageRenderer {
  constructor() {
    this.modalState = {
      images: [],
      currentIndex: 0,
      isOpen: false
    };
    this.dom = domHelper;
  }

  renderImageBar(containerId, images, type) {
    var container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    if (!images || images.length === 0) {
      var msg = document.createElement('div');
      msg.style.cssText = 'color:#666; font-size:11px; font-style:italic; padding:8px; text-align:center;';
      msg.textContent = 'Sin imágenes';
      container.appendChild(msg);
      return;
    }

    var barDiv = document.createElement('div');
    barDiv.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:6px 0;';

    try {
      var maxShow = 5;
      var showImages = images.slice(0, maxShow);
      var extraCount = images.length - maxShow;

      showImages.forEach(function(img, index) {
        var thumbContainer = this._createThumbnailSimple(img, index, images);
        barDiv.appendChild(thumbContainer);
      }.bind(this));

      if (extraCount > 0) {
        var moreDiv = this._createMoreIndicator(extraCount, images, maxShow);
        barDiv.appendChild(moreDiv);
      }
    } catch (e) {
      console.error('[ImageRenderer] Error en renderImageBar:', e);
    }

    container.appendChild(barDiv);
  }

  _createThumbnailSimple(img, index, images) {
    var thumbContainer = document.createElement('div');
    thumbContainer.style.cssText = 'position:relative; cursor:pointer; border-radius:6px; overflow:hidden; border:2px solid #e0e0e0; transition:all 0.2s;';
    thumbContainer.onmouseover = function() { this.style.borderColor = '#1976d2'; this.style.transform = 'scale(1.05)'; };
    thumbContainer.onmouseout = function() { this.style.borderColor = '#e0e0e0'; this.style.transform = 'scale(1)'; };

    var thumb = document.createElement('div');
    thumb.style.cssText = 'width:60px; height:60px; display:flex; align-items:center; justify-content:center; background:#f5f5f5; position:relative;';

    if (img.content_type && img.content_type.startsWith('image/')) {
      var imgEl = document.createElement('img');
      imgEl.style.cssText = 'width:100%; height:100%; object-fit:cover;';
      imgEl.src = img.url;
      imgEl.alt = img.filename || 'Imagen';
      thumb.appendChild(imgEl);
    } else {
      var icon = document.createElement('div');
      icon.style.cssText = 'font-size:24px; color:#666;';
      icon.textContent = this._getFileIcon(img.filename);
      thumb.appendChild(icon);
    }

    var badge = document.createElement('div');
    badge.style.cssText = 'position:absolute; bottom:2px; right:2px; background:rgba(0,0,0,0.7); color:white; font-size:8px; padding:1px 3px; border-radius:2px;';
    badge.textContent = this._getFileTypeBadge(img.content_type);
    thumb.appendChild(badge);

    var self = this;
    thumbContainer.onclick = function() {
      self.openImageModal(images, index);
    };

    thumbContainer.appendChild(thumb);
    return thumbContainer;
  }

  _openWithPreload(img, index, images) {
    if (index < images.length - 1) {
      var nextImg = new Image();
      nextImg.src = images[index + 1].url;
    }
    window.open(img.url, '_blank');
  }

  _createMoreIndicator(extraCount, images, maxShow) {
    var moreDiv = document.createElement('div');
    moreDiv.style.cssText = 'width:60px; height:60px; display:flex; align-items:center; justify-content:center; background:#e3f2fd; border-radius:6px; border:2px solid #1976d2; cursor:pointer; font-size:12px; font-weight:600; color:#1976d2;';
    moreDiv.textContent = '+' + extraCount;
    moreDiv.title = 'Ver ' + extraCount + ' archivos más';
    moreDiv.onclick = function() { this.openImageModal(images, maxShow); }.bind(this);
    return moreDiv;
  }

  _getFileIcon(filename) {
    if (!filename) return '📄';
    var ext = filename.split('.').pop().toLowerCase();
    var icons = {
      pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
      mp4: '🎥', avi: '🎥', mov: '🎥', zip: '📦', rar: '📦'
    };
    return icons[ext] || '📄';
  }

  _getFileTypeBadge(contentType) {
    if (!contentType) return 'FILE';
    if (contentType.startsWith('image/')) return 'IMG';
    if (contentType === 'application/pdf') return 'PDF';
    if (contentType.includes('video/')) return 'VID';
    if (contentType.includes('zip') || contentType.includes('rar')) return 'ZIP';
    return 'FILE';
  }

  openImageModal(images, startIndex) {
    openImageViewer(images, startIndex, {
      getFileIcon: this._getFileIcon.bind(this)
    });
  }
}

var imageRenderer = new ImageRenderer();

function renderImageBar(containerId, images, type) {
  return imageRenderer.renderImageBar(containerId, images, type);
}

function openImageModal(images, startIndex) {
  return imageRenderer.openImageModal(images, startIndex);
}

function openAddImageModal(type) {
  alert('Funcionalidad para agregar imágenes en desarrollo');
}

// ---- Guardar presentación & Stats ----
async function guardarPresentacion() {
  var sel = document.getElementById('presReclamoSelect');
  var id = parseInt(sel.value);
  if (!id) return;

  var msg = document.getElementById('presGuardarMsg');
  var asistentes = [];
  document.querySelectorAll('.pres-asistente-cb:checked').forEach(function(cb) {
    asistentes.push(cb.value);
  });
  var comentarios = document.getElementById('presComentarios').value.trim();

  if (asistentes.length === 0) {
    msg.textContent = 'Selecciona al menos un asistente';
    msg.style.color = '#b42318';
    return;
  }
  if (!comentarios) {
    msg.textContent = 'Ingresa comentarios de la presentación';
    msg.style.color = '#b42318';
    return;
  }

  msg.textContent = 'Guardando...';
  msg.style.color = '#666';

  var res = await fetch(apiUrl('/reclamos/' + id + '/presentar'), {
    method: 'POST',
    headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ asistentes: asistentes, comentarios: comentarios })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = '✅ Presentación registrada';
    msg.style.color = '#2e7d32';
    await loadPresentaciones();
    sel.value = id;
    seleccionarReclamoPres();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido');
    msg.style.color = '#b42318';
  }
}

async function loadPresStats() {
  var data = await apiGet('/reclamos/presentaciones-stats');
  if (!data) return;

  document.getElementById('presDashPresentados').textContent = data.presentados || 0;
  document.getElementById('presDashPorPresentar').textContent = data.por_presentar || 0;

  var ppData = data.por_presentar_por_cubicador || [];
  var ctxPP = document.getElementById('presChartPorPresentar');
  if (ctxPP) {
    _presChartPorPresentar = replaceChart(_presChartPorPresentar, ctxPP, {
      type: 'bar',
      data: {
        labels: ppData.map(function(d) { return d.nombre; }),
        datasets: [{
          data: ppData.map(function(d) { return d.total; }),
          backgroundColor: ppData.map(function(d, i) { return _presColors[i % _presColors.length]; }),
          borderRadius: 3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } }
      }
    });
  }

  var prData = data.presentados_por_cubicador || [];
  var ctxPR = document.getElementById('presChartPresentados');
  if (ctxPR) {
    _presChartPresentados = replaceChart(_presChartPresentados, ctxPR, {
      type: 'bar',
      data: {
        labels: prData.map(function(d) { return d.nombre; }),
        datasets: [{
          data: prData.map(function(d) { return d.total; }),
          backgroundColor: prData.map(function(d, i) { return _presColors[i % _presColors.length]; }),
          borderRadius: 3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } }
      }
    });
  }
}
