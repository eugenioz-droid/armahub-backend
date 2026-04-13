var _reclamoActual = null;
var _ishikawaData = null;
var _ishikawaTarget = 'create';
var _ishikawaSelection = { categoria: '', sub_causa: '', cod_causa: '' };

var _recEstadoColors = {
  abierto: '#e53935', en_analisis: '#ff9800', accion_correctiva: '#2196F3',
  validacion: '#7B1FA2', cerrado: '#4CAF50', rechazado: '#9E9E9E'
};
var _recEstadoLabels = {
  abierto: 'Abierto', en_analisis: 'En análisis', accion_correctiva: 'Acción correctiva',
  validacion: 'En validación', cerrado: 'Cerrado', rechazado: 'Rechazado'
};
var _recPrioridadColors = {
  baja: '#9E9E9E', media: '#ff9800', alta: '#e53935', critica: '#b71c1c'
};
var _recPrioridadLabels = {
  baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica'
};
var _recIshikawaLabels = {
  mano_de_obra: 'Personas (Mano de obra)', metodo: 'Método', material: 'Material',
  maquina: 'Máquina', medicion: 'Medida', medio_ambiente: 'Medio Ambiente'
};
var _recAplicaLabels = { si: 'Sí aplica', no: 'No aplica', pendiente: 'Pendiente' };
var _recAplicaColors = { si: '#e53935', no: '#4CAF50', pendiente: '#ff9800' };
var _recAccionTipoColors = { inmediata: '#e53935', correctiva: '#2196F3', preventiva: '#4CAF50' };
var _ishikawaCatColors = {
  medio_ambiente: '#26A69A', material: '#5C6BC0', maquina: '#EF5350',
  medicion: '#AB47BC', metodo: '#FFA726', mano_de_obra: '#42A5F5'
};

var _recLandChartHist = null;
var _recCatColors = {
  mano_de_obra: '#42A5F5', metodo: '#FFA726', material: '#66BB6A',
  maquina: '#EF5350', medicion: '#AB47BC', medio_ambiente: '#26A69A',
  sin_categoria: '#BDBDBD'
};
var _recCatLabels = {
  mano_de_obra: 'Personas', metodo: 'Método', material: 'Material',
  maquina: 'Máquina', medicion: 'Medida', medio_ambiente: 'Medio Amb.',
  sin_categoria: 'Sin cat.'
};

function _normalizeReclamoDateInputValue(value) {
  return formatDateInput(value);
}

function _buildReclamoCausaDisplay(detail) {
  var causaDisplay = '';
  if (detail.cod_causa && detail.sub_causa) {
    causaDisplay = '[' + detail.cod_causa + '] ' + (_recIshikawaLabels[detail.categoria_ishikawa] || '') + ' > ' + detail.sub_causa;
  } else if (detail.categoria_ishikawa) {
    causaDisplay = _recIshikawaLabels[detail.categoria_ishikawa] || detail.categoria_ishikawa;
  }
  if (causaDisplay && detail.explicacion_causa) {
    causaDisplay += ' — ' + detail.explicacion_causa;
  } else if (!causaDisplay && detail.explicacion_causa) {
    causaDisplay = detail.explicacion_causa;
  }
  return causaDisplay;
}

function _adaptLegacyReclamoActionRows(detail) {
  if (detail.acciones && detail.acciones.length > 0) return detail.acciones;
  var legacyAcciones = [];
  if (detail.accion_correctiva) {
    legacyAcciones.push({
      id: 'legacy-correctiva',
      tipo: 'correctiva',
      descripcion: detail.accion_correctiva,
      responsable: detail.responsable || detail.cubicador_asignado || null,
      fecha_prevista: detail.fecha_analisis || null,
      estado: 'completada'
    });
  }
  if (detail.accion_preventiva) {
    legacyAcciones.push({
      id: 'legacy-preventiva',
      tipo: 'preventiva',
      descripcion: detail.accion_preventiva,
      responsable: detail.responsable || detail.cubicador_asignado || null,
      fecha_prevista: detail.fecha_analisis || null,
      estado: 'completada'
    });
  }
  return legacyAcciones;
}

function _adaptLegacyReclamoImageType(tipo) {
  if (tipo === 'antecedente' || !tipo) return 'ImagenesRegistro';
  if (tipo === 'respuesta') return 'ImagenesAnalisis';
  return tipo;
}

function _adaptLegacyReclamoImages(imagenes) {
  var source = Array.isArray(imagenes) ? imagenes : [];
  return source.map(function(img) {
    var normalizedImage = Object.assign({}, img || {});
    normalizedImage.tipo = _adaptLegacyReclamoImageType(normalizedImage.tipo);
    return normalizedImage;
  });
}

function _splitCanonicalReclamoImages(imagenes) {
  var source = Array.isArray(imagenes) ? imagenes : [];
  return {
    antecedentes: source.filter(function(img) {
      return img.tipo === 'ImagenesRegistro';
    }),
    respuesta: source.filter(function(img) {
      return img.tipo === 'ImagenesAnalisis';
    })
  };
}

function _adaptLegacyReclamoDetail(detail) {
  var adapted = Object.assign({}, detail || {});
  adapted.imagenes = _adaptLegacyReclamoImages(adapted.imagenes || []);
  adapted.acciones = _adaptLegacyReclamoActionRows(adapted);
  adapted.respuesta_texto_display = adapted.respuesta_texto || adapted.explicacion_causa || '';
  return adapted;
}

function _adaptLegacyPresentacionRecord(listItem, detail) {
  var adapted = Object.assign({}, listItem || {}, detail || {});
  adapted.correlativo = adapted.correlativo || (adapted.id ? '#' + adapted.id : '');
  adapted.nombre_proyecto = adapted.nombre_proyecto || '';
  adapted.cubicador_nombre = adapted.cubicador_nombre || '—';
  adapted.aplica = adapted.aplica || 'pendiente';
  adapted.fecha_deteccion_input = adapted.fecha_deteccion_input || _normalizeReclamoDateInputValue(adapted.fecha_deteccion);
  return adapted;
}

function _normalizeReclamoListItem(reclamo) {
  var normalized = Object.assign({}, reclamo || {});
  normalized.tipo_reclamo = normalized.tipo_reclamo || 'error';
  normalized.aplica = normalized.aplica || 'pendiente';
  normalized.fecha_deteccion = normalized.fecha_deteccion || '';
  normalized.nombre_proyecto = normalized.nombre_proyecto || '';
  normalized.correlativo = normalized.correlativo || (normalized.id ? '#' + normalized.id : '');
  return normalized;
}

function _normalizeReclamoDetail(detail) {
  var normalized = _adaptLegacyReclamoDetail(detail);
  normalized.causa_display = _buildReclamoCausaDisplay(normalized);
  normalized.fecha_deteccion_input = _normalizeReclamoDateInputValue(normalized.fecha_deteccion);
  normalized.fecha_analisis_input = _normalizeReclamoDateInputValue(normalized.fecha_analisis);
  normalized.acciones_normalized = normalized.acciones || [];
  var splitImages = _splitCanonicalReclamoImages(normalized.imagenes || []);
  normalized.imagenes_antecedentes = splitImages.antecedentes;
  normalized.imagenes_respuesta = splitImages.respuesta;
  return normalized;
}

var _presData = null;
var _presChartPorPresentar = null;
var _presChartPresentados = null;
var _presColors = ['#7B1FA2','#1565C0','#e53935','#ff9800','#2e7d32','#00897B','#795548','#607D8B','#F44336','#009688'];

async function loadPresentaciones() {
  var data = await apiGet('/reclamos/para-presentar');
  if (!data) return;
  _presData = Object.assign({}, data, {
    reclamos: (data.data || []).map(_normalizeReclamoListItem)
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
  var estadoLabels = {abierto:'Abierto', en_análisis:'En análisis', accion_correctiva:'Acción correctiva', validacion:'Validación', cerrado:'Cerrado', rechazado:'Rechazado'};
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
  document.getElementById('presIdCalidad').textContent = detail.id_calidad || '—';
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

class FormRenderer {
  constructor() {
    this.fieldMappings = {
      registro: {
        descripcion: ['descripcion', 'rec.descripcion'],
        responsable: ['responsable', 'rec.responsable'],
        prioridad: ['prioridad', 'rec.prioridad'],
        id_calidad: ['id_calidad', 'rec.id_calidad'],
        observaciones: ['observaciones', 'rec.observaciones']
      },
      analisis: {
        explicacion_causa: ['explicacion_causa'],
        area_aplica: ['area_aplica'],
        respuesta_texto: ['respuesta_texto'],
        fecha_analisis: ['fecha_analisis'],
        respuesta_por: ['respuesta_por'],
        respuesta_fecha: ['respuesta_fecha']
      }
    };
  }

  renderRegistroForm(detail, rec) {
    var fields = this.fieldMappings.registro;
    document.getElementById('presDescripcion').textContent = this._getValue(detail, fields.descripcion) || '—';
    document.getElementById('presResponsable').textContent = this._getValue(detail, fields.responsable) || '—';
    document.getElementById('presPrioridad').textContent = this._getValue(detail, fields.prioridad) || '—';
    document.getElementById('presIdCalidad').textContent = this._getValue(detail, fields.id_calidad) || '—';
    document.getElementById('presObservaciones').textContent = this._getValue(detail, fields.observaciones) || '—';
  }

  renderAnalisisForm(detail) {
    console.log('[DEBUG] Datos formulario azul CORREGIDOS:', {
      explicacion_causa: detail.explicacion_causa,
      area_aplica: detail.area_aplica,
      respuesta_texto: detail.respuesta_texto,
      fecha_analisis: detail.fecha_analisis,
      respuesta_por: detail.respuesta_por,
      respuesta_fecha: detail.respuesta_fecha
    });

    document.getElementById('presIshikawa').textContent = detail.explicacion_causa || '—';
    document.getElementById('presArea').textContent = detail.area_aplica || '—';
    document.getElementById('presRespuesta').textContent = detail.respuesta_texto || '—';
    document.getElementById('presFechaAnalisis').textContent = this._formatDateTime(detail.fecha_analisis);
    document.getElementById('presRespondidoPor').textContent = detail.respuesta_por || '—';
    document.getElementById('presFechaRespuesta').textContent = this._formatDateTime(detail.respuesta_fecha);
  }

  renderAcciones(acciones) {
    var accDiv = document.getElementById('presAcciones');
    accDiv.innerHTML = '';
    if (!acciones || acciones.length === 0) {
      accDiv.innerHTML = '<div style="color:#666; font-style:italic;">Sin acciones registradas</div>';
      return;
    }

    var tipoAccLabels = {inmediata:'Inmediata', correctiva:'Correctiva', preventiva:'Preventiva'};
    acciones.forEach(function(a) {
      var row = document.createElement('div');
      row.style.cssText = 'padding:4px 6px; background:#fff; border-radius:4px; margin-bottom:3px; display:flex; gap:6px; align-items:center;';
      var badge = a.estado === 'completada' ? '✅' : '⏳';
      row.innerHTML = badge + ' <strong>' + (tipoAccLabels[a.tipo] || a.tipo) + ':</strong> ' +
        (a.descripcion || '') +
        (a.responsable ? ' <span style="color:#666;">(' + a.responsable + ')</span>' : '');
      accDiv.appendChild(row);
    });
  }

  renderPresentacionStatus(detail) {
    var yaPres = document.getElementById('presYaPresentado');
    var regCard = document.getElementById('presRegistroCard');

    if (detail.presentacion_realizada) {
      yaPres.style.display = '';
      regCard.style.display = 'none';
      document.getElementById('presYaFecha').textContent = this._formatDateTime(detail.presentacion_fecha);
      document.getElementById('presYaPor').textContent = detail.presentacion_por || '—';

      var asistEmails = (detail.presentacion_asistentes || '').split(',').filter(Boolean);
      var usuariosPresentacion = (_presData && Array.isArray(_presData.cubicadores)) ? _presData.cubicadores : [];
      var asistNames = asistEmails.map(function(email) {
        var user = usuariosPresentacion.find(function(u) { return u.email === email; });
        return user ? (user.nombre || user.email) : email;
      });
      document.getElementById('presYaAsistentes').textContent = asistNames.join(', ') || '—';
      document.getElementById('presYaComentarios').textContent = detail.presentacion_comentarios || '—';
    } else {
      yaPres.style.display = 'none';
      regCard.style.display = '';
    }
  }

  _getValue(detail, fieldPaths) {
    if (!fieldPaths || !Array.isArray(fieldPaths)) return null;
    for (var index = 0; index < fieldPaths.length; index += 1) {
      var value = this._getNestedValue(detail, fieldPaths[index]);
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }

  _getNestedValue(obj, path) {
    return path.split('.').reduce(function(current, key) {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  _formatDateTime(dateStr) {
    return formatDateTime(dateStr, '—');
  }
}

var formRenderer = new FormRenderer();

class ReclamoPresenter {
  constructor() {
    this.imageRenderer = imageRenderer;
    this.formRenderer = formRenderer;
    this.dom = domHelper;
  }

  seleccionarReclamoPres() {
    var recId = this.dom.getValue('reclamoSelect');
    if (!ReclamoUtils.isValidReclamoId(recId)) return;

    var rec = _presData.reclamos.find(function(r) { return r.id == recId; });
    if (!rec) return;

    this._showLoading();

    var self = this;
    apiGet('/reclamos/' + recId).then(function(detail) {
      if (!detail) {
        self._showError('Error cargando detalles del reclamo');
        return;
      }

      ReclamoUtils.log('Datos recibidos', detail);
      self._renderReclamoCompleto(detail, rec);
    }).catch(function(err) {
      console.error('Error:', err);
      self._showError('Error al cargar el reclamo');
    });
  }

  _showLoading() {
    this.dom.hide('antecedentes');
    this.dom.hide('registroCard');
    this.dom.hide('yaPresentado');
    var select = this.dom.get('reclamoSelect');
    if (select) {
      select.disabled = true;
      select.style.opacity = '0.5';
    }
  }

  _showError(message) {
    this._hideLoading();
    alert(message);
  }

  _hideLoading() {
    var select = this.dom.get('reclamoSelect');
    if (select) {
      select.disabled = false;
      select.style.opacity = '1';
    }
  }

  _renderReclamoCompleto(detail, rec) {
    this.dom.show('antecedentes');
    this.dom.hide('registroCard');
    this.dom.hide('yaPresentado');
    this.formRenderer.renderRegistroForm(detail, rec);
    this.formRenderer.renderAnalisisForm(detail);
    this.formRenderer.renderAcciones(detail.acciones);
    this._renderImages(detail);
    this.formRenderer.renderPresentacionStatus(detail);
    this._hideLoading();
  }

  _renderImages(detail) {
    var self = this;
    setTimeout(function() {
      var imagenes = detail.imagenes || [];
      ReclamoUtils.log('Imágenes encontradas', imagenes);

      var imagenesRegistro = ReclamoUtils.filterImagesByType(imagenes, 'ImagenesRegistro');
      var imagenesAnalisis = ReclamoUtils.filterImagesByType(imagenes, 'ImagenesAnalisis');

      ReclamoUtils.log('ImágenesRegistro (rojo)', imagenesRegistro.length);
      ReclamoUtils.log('ImágenesAnalisis (azul)', imagenesAnalisis.length);

      var imgRecDiv = self.dom.get('imagenesReclamo');
      var imgRespDiv = self.dom.get('imagenesRespuesta');

      if (imagenesRegistro.length > 0) {
        self.imageRenderer.renderImageBar('presImagenesReclamo', imagenesRegistro, 'reclamo');
      } else if (imgRecDiv) {
        imgRecDiv.innerHTML = '<div style="padding:8px; text-align:center; color:#999; font-style:italic;">📷 Sin imágenes de registro</div>';
      }

      if (imagenesAnalisis.length > 0) {
        self.imageRenderer.renderImageBar('presImagenesRespuesta', imagenesAnalisis, 'respuesta');
      } else if (imgRespDiv) {
        imgRespDiv.innerHTML = '<div style="padding:8px; text-align:center; color:#999; font-style:italic;">📷 Sin imágenes de análisis</div>';
      }
    }, 200);
  }
}

class ReclamoUtils {
  static filterImagesByType(images, type) {
    if (!images || !Array.isArray(images)) return [];
    return images.filter(function(img) { return img.tipo === type; });
  }

  static formatDateShort(dateString) {
    return formatDateShort(dateString, '');
  }

  static formatDateFull(dateString) {
    return formatDateTime(dateString, '');
  }

  static exists(value) {
    return value !== null && value !== undefined && value !== '';
  }

  static getValue(obj, path, fallback) {
    if (!obj) return fallback === undefined ? '—' : fallback;
    if (path.includes('.')) {
      var nested = path.split('.').reduce(function(current, key) {
        return current && current[key] !== undefined ? current[key] : undefined;
      }, obj);
      return nested || (fallback === undefined ? '—' : fallback);
    }
    return obj[path] !== undefined ? obj[path] : (fallback === undefined ? '—' : fallback);
  }

  static formatText(value, fallback) {
    return this.exists(value) ? String(value) : (fallback === undefined ? '—' : fallback);
  }

  static getEstadoLabel(estado) {
    var labels = {
      abierto: 'Abierto',
      en_análisis: 'En análisis',
      accion_correctiva: 'Acción correctiva',
      validacion: 'Validación',
      cerrado: 'Cerrado',
      rechazado: 'Rechazado'
    };
    return labels[estado] || estado;
  }

  static getAplicaLabel(aplica) {
    var labels = { si: 'Sí aplica', no: 'No aplica', pendiente: 'Pendiente' };
    return labels[aplica] || aplica;
  }

  static getAplicaColor(aplica) {
    var colors = { si: '#2e7d32', no: '#b42318', pendiente: '#e65100' };
    return colors[aplica] || '#666';
  }

  static getAccionLabel(tipo) {
    var labels = { inmediata: 'Inmediata', correctiva: 'Correctiva', preventiva: 'Preventiva' };
    return labels[tipo] || tipo;
  }

  static isValidReclamoId(id) {
    return this.exists(id) && !isNaN(parseInt(id, 10)) && parseInt(id, 10) > 0;
  }

  static getImageUrl(reclamoId, imageId) {
    return '/reclamos/' + reclamoId + '/imagenes/' + imageId;
  }

  static log(prefix, data) {
    console.log('[ReclamoUtils] ' + prefix + ':', data);
  }
}

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

  var res = await fetch('/reclamos/' + id + '/presentar', {
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

// ========================= CORE RECLAMOS =========================

// ---- ADMIN DASHBOARDS TAB ----
let _recDashHist = null, _recDashResueltos = null, _recDashTipo = null;
let _recDashUSC = null, _recDashCubAsig = null, _recDashIshikawa = null, _recDashKilos = null;
let _recDashProyecto = null, _recDashProyectoMes = null;
var _adminDashLoaded = false;
var _recLandChartResueltos = null; // also used in loadRecLanding

function switchRecTab(tab) {
  var mainTab = document.getElementById('recTabMain');
  var dashTab = document.getElementById('recTabDashboards');
  var presTab = document.getElementById('recTabPresentaciones');
  var btnMain = document.getElementById('recTabBtnMain');
  var btnDash = document.getElementById('recTabBtnDash');
  var btnPres = document.getElementById('recTabBtnPres');

  // Hide all tabs, reset all buttons
  mainTab.style.display = 'none';
  dashTab.style.display = 'none';
  if (presTab) presTab.style.display = 'none';
  btnMain.style.borderBottomColor = 'transparent'; btnMain.style.color = '#999';
  btnDash.style.borderBottomColor = 'transparent'; btnDash.style.color = '#999';
  if (btnPres) { btnPres.style.borderBottomColor = 'transparent'; btnPres.style.color = '#999'; }

  if (tab === 'dashboards') {
    dashTab.style.display = '';
    btnDash.style.borderBottomColor = '#1565C0'; btnDash.style.color = '#1565C0';
    loadRecAdminDashboards();
    window.location.hash = 'dashboards';
  } else if (tab === 'presentaciones') {
    if (presTab) presTab.style.display = '';
    if (btnPres) { btnPres.style.borderBottomColor = '#7B1FA2'; btnPres.style.color = '#7B1FA2'; }
    loadPresentaciones();
    window.location.hash = 'presentaciones';
  } else {
    mainTab.style.display = '';
    btnMain.style.borderBottomColor = '#e53935'; btnMain.style.color = '#e53935';
    _adminDashLoaded = false;
    window.location.hash = '';
  }
}

async function loadRecLanding() {
  var data = await apiGet('/reclamos/mi-resumen');
  if (!data) return;

  var isAdmin = (currentRole === 'admin' || currentRole === 'admin2' || currentRole === 'coordinador');
  var titleEl = document.querySelector('#recLandingCharts').parentElement.querySelector('h3');
  if (titleEl) titleEl.textContent = isAdmin ? 'Resumen General' : 'Mi Resumen';

  // Show dashboards tab button for admin
  var dashBtn = document.getElementById('recTabBtnDash');
  if (dashBtn) dashBtn.style.display = isAdmin ? '' : 'none';

  // Show presentaciones tab button for admin/admin2/cubicador
  var presBtn = document.getElementById('recTabBtnPres');
  var presAccess = ['admin','admin2','cubicador'];
  if (presBtn) presBtn.style.display = presAccess.includes(currentRole) ? '' : 'none';

  // Chart 1: KPI
  document.getElementById('recLandTotal').textContent = data.total || 0;
  document.getElementById('recLandAbiertos').textContent = (data.abiertos || 0) + ' abiertos';

  // Chart 2: Estados (reemplaza Resueltos vs No Resueltos)
  var porEstado = data.por_estado || {};
  console.log('[loadRecLanding] por_estado:', porEstado);
  
  // Convertir a array si viene como objeto (landing page)
  if (!Array.isArray(porEstado)) {
    porEstado = Object.keys(porEstado).map(estado => ({
      estado: estado,
      count: porEstado[estado]
    }));
  }
  
  var estados = porEstado.map(item => item.estado);
  var valores = porEstado.map(item => item.count);
  
  // Preparar datos para el gráfico de torta
  var labels = porEstado.map(item => {
    var estado = item.estado;
    var label = _recEstadoLabels[estado] || estado;
    var count = item.count;
    return `${label} (${count})`;
  });
  var colors = estados.map(estado => _recEstadoColors[estado] || '#999');
  
  _recLandChartResueltos = replaceChart(_recLandChartResueltos, document.getElementById('recLandChartResueltos'), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ 
        data: valores, 
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      plugins: { 
        legend: { 
          position: 'bottom', 
          labels: { 
            font: { size: 11 }, 
            padding: 10,
            usePointStyle: true,
            pointStyle: 'circle'
          } 
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              var item = porEstado[context.dataIndex];
              var estado = item.estado;
              var label = _recEstadoLabels[estado] || estado;
              var value = item.count;
              var total = context.dataset.data.reduce((a, b) => a + b, 0);
              var percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value} (${percentage}%)`;
            }
          }
        }
      }
    }
  });

  // Chart 3: Historical monthly bar (grouped by year, using fecha_deteccion from backend)
  var _mesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var _anioColores = ['#e53935','#1565C0','#2e7d32','#ff9800','#7B1FA2','#00897B'];
  var anioMesData = data.por_anio_mes || [];
  var aniosSet = {};
  anioMesData.forEach(function(d) { aniosSet[d.anio] = true; });
  var anios = Object.keys(aniosSet).map(Number).sort();
  var datasets = anios.map(function(anio, idx) {
    var counts = new Array(12).fill(0);
    anioMesData.forEach(function(d) { if (d.anio === anio) counts[d.mes - 1] = d.count; });
    return { label: '' + anio, data: counts, backgroundColor: _anioColores[idx % _anioColores.length], borderRadius: 2 };
  });
  _recLandChartHist = replaceChart(_recLandChartHist, document.getElementById('recLandChartHist'), {
    type: 'bar',
    data: { labels: _mesNombres, datasets: datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: anios.length > 1, labels: { font: { size: 9 } } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } },
                x: { ticks: { font: { size: 9 } } } } }
  });

  // Pending tasks badge (cubicador only)
  var pendWrap = document.getElementById('recLandPendientesWrap');
  var pendCount = data.pendientes || 0;
  if (pendWrap) {
    if (currentRole === 'cubicador' && pendCount > 0) {
      pendWrap.style.display = '';
      document.getElementById('recLandPendientes').textContent = pendCount;
    } else {
      pendWrap.style.display = 'none';
    }
  }
}

async function loadRecAdminDashboards() {
  if (_adminDashLoaded) return;
  var data = await apiGet('/reclamos/admin-dashboards');
  if (!data) return;
  _adminDashLoaded = true;

  var _mesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var _anioColores = ['#e53935','#1565C0','#2e7d32','#ff9800','#7B1FA2','#00897B'];

  // KPI
  document.getElementById('recDashTotal').textContent = data.total || 0;
  document.getElementById('recDashAbiertos').textContent = (data.abiertos || 0);

  // Chart 1: Historico mensual (multi-year grouped bar)
  var anioMesData = data.por_anio_mes || [];
  var aniosSet = {};
  anioMesData.forEach(function(d) { aniosSet[d.anio] = true; });
  var anios = Object.keys(aniosSet).map(Number).sort();
  var histDS = anios.map(function(anio, idx) {
    var counts = new Array(12).fill(0);
    anioMesData.forEach(function(d) { if (d.anio === anio) counts[d.mes - 1] = d.count; });
    return { label: '' + anio, data: counts, backgroundColor: _anioColores[idx % _anioColores.length], borderRadius: 2 };
  });
  _recDashHist = replaceChart(_recDashHist, document.getElementById('recDashChartHist'), {
    type: 'bar',
    data: { labels: _mesNombres, datasets: histDS },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: anios.length > 1, labels: { font: { size: 9 } } },
        datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, anchor: 'end', align: 'end', color: '#333', font: { size: 8, weight: 'bold' } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } } },
    plugins: [ChartDataLabels]
  });

  // Chart 2: Estados (reemplaza Resueltos vs No Resueltos)
  var porEstado = data.por_estado || [];
  // Normalizar: si viene como dict legacy, convertir a array
  if (!Array.isArray(porEstado)) {
    porEstado = Object.keys(porEstado).map(function(k) { return {estado: k, count: porEstado[k]}; });
  }
  var estados = porEstado.map(function(item) { return item.estado; });
  var valores = porEstado.map(function(item) { return item.count; });
  
  // Preparar datos para el gráfico de torta
  var labels = porEstado.map(function(item) {
    var label = _recEstadoLabels[item.estado] || item.estado;
    return `${label} (${item.count})`;
  });
  var colors = estados.map(function(estado) { return _recEstadoColors[estado] || '#999'; });
  
  _recDashResueltos = replaceChart(_recDashResueltos, document.getElementById('recDashChartResueltos'), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ 
        data: valores, 
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      plugins: { 
        legend: { 
          position: 'bottom', 
          labels: { 
            font: { size: 10 }, 
            padding: 6,
            usePointStyle: true,
            pointStyle: 'circle'
          } 
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              var item = porEstado[context.dataIndex];
              var estado = item.estado;
              var label = _recEstadoLabels[estado] || estado;
              var value = item.count;
              var total = context.dataset.data.reduce((a, b) => a + b, 0);
              var percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value} (${percentage}%)`;
            }
          }
        },
        datalabels: { 
          display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, 
          color: '#fff', 
          font: { size: 10, weight: 'bold' } 
        }
      }
    },
    plugins: [ChartDataLabels]
  });

  // Chart 3: Tipo Error/Faltante/Atraso/Actualización Portal
  var pt = data.por_tipo || {};
  var errC = pt.error || 0; var falC = pt.faltante || 0; var atrC = pt.atraso || 0; var actC = pt.actualizacion_portal || 0;
  _recDashTipo = replaceChart(_recDashTipo, document.getElementById('recDashChartTipo'), {
    type: 'doughnut',
    data: { labels: ['Error (' + errC + ')', 'Faltante (' + falC + ')', 'Atraso (' + atrC + ')', 'Actualización Portal (' + actC + ')'],
            datasets: [{ data: [errC, falC, atrC, actC], backgroundColor: ['#e53935','#ff9800','#7B1FA2','#00897B'] }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 6 } },
        datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, color: '#fff', font: { size: 11, weight: 'bold' } } } },
    plugins: [ChartDataLabels]
  });

  // Chart 4: Detectados por USC (horizontal bar)
  var uscData = data.por_usc || [];
  var uscLabels = uscData.map(function(d) { return d.email.split('@')[0]; });
  var uscTotals = uscData.map(function(d) { return d.total; });
  _recDashUSC = destroyChart(_recDashUSC);
  if (uscData.length > 0) {
    _recDashUSC = replaceChart(_recDashUSC, document.getElementById('recDashChartUSC'), {
      type: 'bar',
      data: { labels: uscLabels, datasets: [
        { label: 'Error', data: uscData.map(function(d) { return d.errores; }), backgroundColor: '#e53935' },
        { label: 'Faltante', data: uscData.map(function(d) { return d.faltantes; }), backgroundColor: '#ff9800' },
        { label: 'Atraso', data: uscData.map(function(d) { return d.atrasos; }), backgroundColor: '#7B1FA2' },
        { label: 'Actualización Portal', data: uscData.map(function(d) { return d.actualizaciones || 0; }), backgroundColor: '#00897B' }
      ]},
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { labels: { font: { size: 9 } } },
          datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, color: '#fff', font: { size: 8, weight: 'bold' } } },
        scales: { x: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } }, y: { stacked: true, ticks: { font: { size: 9 } } } } },
      plugins: [ChartDataLabels]
    });
  } else {
    document.getElementById('recDashChartUSC').parentElement.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin datos USC aún</div>';
  }

  // Chart 5: Por cubicador asignado (donut)
  var cubAsigData = data.por_cubicador_asignado || [];
  _recDashCubAsig = destroyChart(_recDashCubAsig);
  var cubAsigColors = ['#2e7d32','#1565C0','#ff9800','#e53935','#7B1FA2','#00897B','#795548','#607D8B'];
  var cubAsigLabels = cubAsigData.map(function(d, i) {
    var label = d.cubicador.includes('@') ? d.cubicador.split('@')[0] : d.cubicador;
    return label + ' (' + d.count + ')';
  });
  _recDashCubAsig = replaceChart(_recDashCubAsig, document.getElementById('recDashChartCubAsig'), {
    type: 'doughnut',
    data: { labels: cubAsigLabels,
            datasets: [{ data: cubAsigData.map(function(d) { return d.count; }),
                         backgroundColor: cubAsigColors.slice(0, cubAsigData.length) }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, padding: 5 } },
        datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, color: '#fff', font: { size: 10, weight: 'bold' } } } },
    plugins: [ChartDataLabels]
  });

  // Chart 6: Causas Ishikawa global (donut)
  var ishData = data.ishikawa_global || [];
  _recDashIshikawa = destroyChart(_recDashIshikawa);
  if (ishData.length > 0) {
    var ishLabels = ishData.map(function(d) { return (_recCatLabels[d.categoria] || d.categoria) + ' (' + d.count + ')'; });
    var ishValues = ishData.map(function(d) { return d.count; });
    var ishColors = ishData.map(function(d) { return _recCatColors[d.categoria] || '#BDBDBD'; });
    _recDashIshikawa = replaceChart(_recDashIshikawa, document.getElementById('recDashChartIshikawa'), {
      type: 'doughnut',
      data: { labels: ishLabels, datasets: [{ data: ishValues, backgroundColor: ishColors }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, padding: 4 } },
          datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, color: '#fff', font: { size: 10, weight: 'bold' } } } },
      plugins: [ChartDataLabels]
    });
  } else {
    document.getElementById('recDashChartIshikawa').parentElement.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin causas registradas</div>';
  }

  // Chart 7: Kilos mal fabricados por cubicador (horizontal bar)
  var kilosData = data.kilos_por_cubicador || [];
  _recDashKilos = destroyChart(_recDashKilos);
  if (kilosData.length > 0) {
    var kilosLabels = kilosData.map(function(d) { return d.cubicador.includes('@') ? d.cubicador.split('@')[0] : d.cubicador; });
    var kilosVals = kilosData.map(function(d) { return d.kilos; });
    _recDashKilos = replaceChart(_recDashKilos, document.getElementById('recDashChartKilos'), {
      type: 'bar',
      data: { labels: kilosLabels, datasets: [{ label: 'Kilos', data: kilosVals, backgroundColor: '#e53935', borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false },
          datalabels: { anchor: 'end', align: 'end', color: '#333', font: { size: 9, weight: 'bold' } } },
        scales: { x: { beginAtZero: true, ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } },
      plugins: [ChartDataLabels]
    });
  } else {
    document.getElementById('recDashChartKilos').parentElement.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin kilos registrados</div>';
  }

  // Chart 8: Reclamos por Proyecto (horizontal bar) - ALL projects
  var proyData = data.por_proyecto || [];
  var ctxProy = document.getElementById('recDashChartProyecto');
  if (ctxProy) {
    _recDashProyecto = destroyChart(_recDashProyecto);
    if (proyData.length > 0) {
      // Dynamic height: 25px per project, min 200px
      var chartHeight = Math.max(200, proyData.length * 25);
      ctxProy.parentElement.style.height = chartHeight + 'px';
      var proyLabels = proyData.map(function(d) { return d.proyecto.length > 25 ? d.proyecto.substring(0, 23) + '...' : d.proyecto; });
      var proyVals = proyData.map(function(d) { return d.count; });
      _recDashProyecto = replaceChart(_recDashProyecto, ctxProy, {
        type: 'bar',
        data: { labels: proyLabels, datasets: [{ label: 'Reclamos', data: proyVals, backgroundColor: '#1565C0', borderRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
          plugins: { legend: { display: false },
            datalabels: { anchor: 'end', align: 'end', color: '#333', font: { size: 9, weight: 'bold' }, formatter: function(v) { return v; } } },
          scales: { x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } },
        plugins: [ChartDataLabels]
      });
    } else {
      ctxProy.parentElement.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin datos</div>';
    }
  }

  // Chart 9: Reclamos por Proyecto/Mes - HEATMAP TABLE (scalable for all projects)
  var proyMesData = data.proyecto_por_mes || [];
  var ctxProyMes = document.getElementById('recDashChartProyectoMes');
  if (ctxProyMes) {
    // Destroy chart if exists (we're replacing with a table)
    if (_recDashProyectoMes) { _recDashProyectoMes.destroy(); _recDashProyectoMes = null; }
    var container = ctxProyMes.parentElement;
    
    if (proyMesData.length > 0) {
      // Get unique months and projects
      var mesesSet = {};
      var proyectosSet = {};
      var maxCount = 0;
      proyMesData.forEach(function(d) { 
        mesesSet[d.mes] = true; 
        proyectosSet[d.proyecto] = true;
        if (d.count > maxCount) maxCount = d.count;
      });
      var meses = Object.keys(mesesSet).sort();
      var proyectos = Object.keys(proyectosSet).sort();
      
      // Build lookup map
      var dataMap = {};
      proyMesData.forEach(function(d) { dataMap[d.proyecto + '|' + d.mes] = d.count; });
      
      // Generate heatmap table HTML
      var html = '<div style="overflow-x:auto; max-height:390px; overflow-y:auto;">';
      html += '<table style="width:100%; border-collapse:collapse; font-size:10px;">';
      html += '<thead><tr style="position:sticky; top:0; background:#fff; z-index:1;"><th style="padding:3px 4px; text-align:left; border-bottom:1px solid #ddd; min-width:120px;">Proyecto</th>';
      meses.forEach(function(m) {
        html += '<th style="padding:3px 4px; text-align:center; border-bottom:1px solid #ddd; min-width:45px;">' + m.substring(5) + '</th>';
      });
      html += '<th style="padding:3px 4px; text-align:center; border-bottom:1px solid #ddd; font-weight:700;">Total</th></tr></thead><tbody>';
      
      proyectos.forEach(function(proy) {
        var rowTotal = 0;
        html += '<tr><td style="padding:3px 4px; border-bottom:1px solid #eee; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px;" title="' + proy + '">' + (proy.length > 20 ? proy.substring(0, 18) + '...' : proy) + '</td>';
        meses.forEach(function(m) {
          var val = dataMap[proy + '|' + m] || 0;
          rowTotal += val;
          var intensity = maxCount > 0 ? Math.min(1, val / maxCount) : 0;
          var bgColor = val === 0 ? '#f5f5f5' : 'rgba(21, 101, 192, ' + (0.15 + intensity * 0.7) + ')';
          var textColor = intensity > 0.5 ? '#fff' : '#333';
          html += '<td style="padding:3px 4px; text-align:center; border-bottom:1px solid #eee; background:' + bgColor + '; color:' + textColor + ';">' + (val || '') + '</td>';
        });
        html += '<td style="padding:3px 4px; text-align:center; border-bottom:1px solid #eee; font-weight:600; background:#e3f2fd;">' + rowTotal + '</td></tr>';
      });
      
      // Totals row
      html += '<tr style="font-weight:600; background:#f5f5f5;"><td style="padding:3px 4px;">Total</td>';
      var grandTotal = 0;
      meses.forEach(function(m) {
        var colTotal = 0;
        proyectos.forEach(function(proy) { colTotal += dataMap[proy + '|' + m] || 0; });
        grandTotal += colTotal;
        html += '<td style="padding:3px 4px; text-align:center;">' + colTotal + '</td>';
      });
      html += '<td style="padding:3px 4px; text-align:center; background:#1565C0; color:#fff;">' + grandTotal + '</td></tr>';
      html += '</tbody></table></div>';
      
      container.innerHTML = html;
    } else {
      container.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin datos</div>';
    }
  }

}

var _recUsersCache = [];
async function loadRecUsersDropdown() {
  var res = await fetch('/users/dropdown', { headers: authHeaders() });
  if (!res.ok) return;
  var data = await res.json();
  _recUsersCache = data.users || [];
  // Populate create form responsable
  var createSel = document.getElementById('recResponsable');
  if (createSel) {
    var val = createSel.value;
    createSel.innerHTML = '<option value="">— Sin asignar —</option>';
    _recUsersCache.forEach(function(u) {
      createSel.innerHTML += '<option value="' + u.email + '" data-display="' + u.display + '">' + u.display + ' (' + u.role + ')' + '</option>';
    });
    createSel.value = val;
  }
  // Populate acciones responsable (all users)
  var accionRespSel = document.getElementById('recNuevaAccionResp');
  if (accionRespSel) {
    var aval = accionRespSel.value;
    accionRespSel.innerHTML = '<option value="">— Seleccionar —</option>';
    _recUsersCache.forEach(function(u) {
      accionRespSel.innerHTML += '<option value="' + u.display + '">' + u.display + ' (' + u.role + ')</option>';
    });
    accionRespSel.value = aval;
  }
  // Populate filter responsable
  var filterSel = document.getElementById('recFiltroResponsable');
  if (filterSel) {
    var fval = filterSel.value;
    filterSel.innerHTML = '<option value="">Responsable: Todos</option>';
    _recUsersCache.forEach(function(u) {
      filterSel.innerHTML += '<option value="' + u.email + '">' + u.display + '</option>';
    });
    filterSel.value = fval;
  }
}

function populateRecFilterProyecto() {
  var src = document.getElementById('recProyecto');
  var dst = document.getElementById('recFiltroProyecto');
  if (!src || !dst) return;
  var fval = dst.value;
  dst.innerHTML = '<option value="">Proyecto: Todos</option>';
  for (var i = 0; i < src.options.length; i++) {
    if (src.options[i].value) {
      dst.innerHTML += '<option value="' + src.options[i].value + '">' + src.options[i].text + '</option>';
    }
  }
  dst.value = fval;
}

async function loadReclamos() {
  var container = document.getElementById('reclamosList');
  var estado = document.getElementById('recFiltroEstado').value;
  var categoria = document.getElementById('recFiltroCategoria').value;
  var aplica = document.getElementById('recFiltroAplica').value;
  var tipo = document.getElementById('recFiltroTipo') ? document.getElementById('recFiltroTipo').value : '';
  var detectado = document.getElementById('recFiltroDetectado') ? document.getElementById('recFiltroDetectado').value : '';
  var proyecto = document.getElementById('recFiltroProyecto') ? document.getElementById('recFiltroProyecto').value : '';
  var responsable = document.getElementById('recFiltroResponsable') ? document.getElementById('recFiltroResponsable').value : '';
  var busqueda = document.getElementById('recFiltroBusqueda') ? document.getElementById('recFiltroBusqueda').value.trim() : '';
  var url = '/reclamos';
  var params = [];
  if (estado) params.push('estado=' + encodeURIComponent(estado));
  if (categoria) params.push('categoria=' + encodeURIComponent(categoria));
  if (aplica) params.push('aplica=' + encodeURIComponent(aplica));
  if (tipo) params.push('tipo_reclamo=' + encodeURIComponent(tipo));
  if (detectado) params.push('detectado_por=' + encodeURIComponent(detectado));
  if (proyecto) params.push('id_proyecto=' + encodeURIComponent(proyecto));
  if (responsable) params.push('responsable=' + encodeURIComponent(responsable));
  if (busqueda) params.push('busqueda=' + encodeURIComponent(busqueda));
  // USC/cubicador/externo only see their own reclamos
  if (['usc','cubicador','externo'].includes(currentRole)) {
    params.push('solo_mios=true');
  }
  if (params.length > 0) url += '?' + params.join('&');

  var data = await apiGet(url);
  if (!data) {
    container.innerHTML = '<div class="muted">No fue posible cargar reclamos en este momento</div>';
    return;
  }
  var reclamos = (data.data || []).map(_normalizeReclamoListItem);
  
  // Load USC users for assignment dropdowns
  await loadUsuariosUsc();

  if (reclamos.length === 0) {
    container.innerHTML = '<div class="muted">No hay reclamos con los filtros seleccionados</div>';
    return;
  }

  container.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:5px 6px;">Corr.</th>' +
    '<th style="padding:5px 6px;">Título</th>' +
    '<th style="padding:5px 6px;">Tipo</th>' +
    '<th style="padding:5px 6px;">Proyecto</th>' +
    '<th style="padding:5px 6px;">Detectado</th>' +
    '<th style="padding:5px 6px;">Responsable</th>' +
    '<th style="padding:5px 6px;">Cubicador</th>' +
    '<th style="padding:5px 6px;">Estado</th>' +
    '<th style="padding:5px 6px;">Aplica</th>' +
    '<th style="padding:5px 6px;">Causa</th>' +
    '<th style="padding:5px 6px;">Fecha</th>' +
    '<th style="padding:5px 4px;"></th>' +
    '</tr>' +
    reclamos.map(function(r) {
      var eColor = _recEstadoColors[r.estado] || '#666';
      var eLabel = _recEstadoLabels[r.estado] || r.estado;
      var aplLabel = _recAplicaLabels[r.aplica] || 'Pendiente';
      var aplColor = _recAplicaColors[r.aplica] || '#ff9800';
      var tipoLabel = r.tipo_reclamo === 'faltante' ? 'Faltante' : 'Error';
      var tipoColor = r.tipo_reclamo === 'faltante' ? '#ff9800' : '#e53935';
      var causaText = r.cod_causa ? '[' + r.cod_causa + ']' : (r.categoria_ishikawa ? _recIshikawaLabels[r.categoria_ishikawa] : '-');
      var fecha = r.fecha_deteccion || (r.fecha_creacion ? r.fecha_creacion.substring(0, 10) : '');
      var idLabel = r.id_calidad ? r.id_calidad : (r.correlativo || '#' + r.id);
      var idSub = r.id_calidad && r.correlativo ? '<br><span class="muted" style="font-size:9px;">' + r.correlativo + '</span>' : '';
      return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="verReclamo(' + r.id + ')">' +
        '<td style="padding:4px 6px; font-size:11px; font-weight:600;">' + idLabel + idSub + '</td>' +
        '<td style="padding:4px 6px; font-weight:500;">' + r.titulo + '</td>' +
        '<td style="padding:4px 6px;"><span style="color:' + tipoColor + '; font-weight:600; font-size:10px;">' + tipoLabel + '</span></td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.nombre_proyecto || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.detectado_por || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.responsable || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.cubicador_asignado ? r.cubicador_asignado.split('@')[0] : '-') + '</td>' +
        '<td style="padding:4px 6px;"><span style="background:' + eColor + '; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px;">' + eLabel + '</span></td>' +
        '<td style="padding:4px 6px;"><span style="color:' + aplColor + '; font-weight:600; font-size:10px;">' + aplLabel + '</span></td>' +
        '<td style="padding:4px 6px; font-size:11px;" title="' + (r.sub_causa || '') + '">' + causaText + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;" class="muted">' + fecha + '</td>' +
        '<td style="padding:4px 4px;"><button class="secondary" style="font-size:10px; padding:2px 6px;" onclick="event.stopPropagation(); verReclamo(' + r.id + ')">Ver</button></td>' +
        '</tr>';
    }).join('') +
    '</table>' +
    '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + reclamos.length + ' reclamo(s)</div>';
}

function limpiarFiltrosReclamos() {
  ['recFiltroBusqueda','recFiltroTipo','recFiltroEstado','recFiltroCategoria','recFiltroAplica','recFiltroDetectado','recFiltroProyecto','recFiltroResponsable'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  loadReclamos();
}

function toggleNuevoReclamo() {
  var form = document.getElementById('nuevoReclamoForm');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function crearReclamo() {
  var titulo = document.getElementById('recTitulo').value.trim();
  var msg = document.getElementById('crearReclamoMsg');
  if (!titulo) { msg.textContent = 'El título es requerido'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Registrando...'; msg.style.color = '#666';

  var body = { titulo: titulo };
  var proyecto = document.getElementById('recProyecto').value;
  var tipoReclamo = document.getElementById('recTipoReclamo').value;
  var respSel = document.getElementById('recResponsable');
  var respEmail = respSel.value;
  var respDisplay = respSel.options[respSel.selectedIndex] ? respSel.options[respSel.selectedIndex].getAttribute('data-display') : '';
  var asignadoA = document.getElementById('recAsignadoA').value;
  var descripcion = document.getElementById('recDescripcion').value.trim();
  var detectadoPor = document.getElementById('recDetectadoPor').value;
  var fechaDeteccion = document.getElementById('recFechaDeteccion').value;
  var idCalidad = document.getElementById('recIdCalidad') ? document.getElementById('recIdCalidad').value.trim() : '';
  if (proyecto) body.id_proyecto = proyecto;
  if (tipoReclamo) body.tipo_reclamo = tipoReclamo;
  if (respEmail) { body.cubicador_asignado = respEmail; body.responsable = respDisplay || respEmail; }
  if (asignadoA) body.asignado_a = asignadoA;
  if (descripcion) body.descripcion = descripcion;
  if (detectadoPor) body.detectado_por = detectadoPor;
  if (fechaDeteccion) body.fecha_deteccion = fechaDeteccion;
  if (idCalidad) body.id_calidad = idCalidad;
  var res = await fetch('/reclamos', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    var label = data.correlativo || ('#' + data.id);
    // Upload staged images (filter nulls from removed previews)
    var filesToUpload = _recCreateStagedFiles.filter(function(f) { return f !== null; });
    if (filesToUpload.length > 0) {
      msg.textContent = label + ' creado. Subiendo ' + filesToUpload.length + ' imagen(es)...'; msg.style.color = '#666';
      for (var i = 0; i < filesToUpload.length; i++) {
        var formData = new FormData();
        formData.append('file', filesToUpload[i]);
        formData.append('tipo', 'antecedente');
        await fetch('/reclamos/' + data.id + '/imagenes', { method: 'POST', headers: authHeaders(), body: formData });
      }
    }
    _recCreateStagedFiles = [];
    msg.textContent = label + ' registrado correctamente'; msg.style.color = '#558B2F';
    ['recTitulo','recDescripcion','recResponsable','recAsignadoA','recDetectadoPor','recFechaDeteccion','recIdCalidad'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('recProyecto').value = '';
    document.getElementById('recCreatePreview').innerHTML = '';
    document.getElementById('recCreateDropMsg').style.display = '';
    document.getElementById('nuevoReclamoForm').style.display = 'none';
    await loadReclamos();
    await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

function toggleNuevoProyectoRec() {
  var form = document.getElementById('nuevoProyectoRecForm');
  if (form) {
    var wasHidden = form.style.display === 'none';
    form.style.display = wasHidden ? '' : 'none';
    // Populate dropdowns when opening
    if (wasHidden) {
      var calcSel = document.getElementById('recNuevoProjCalculista');
      if (calcSel) {
        var calcVal = calcSel.value;
        calcSel.innerHTML = '<option value="">— Sin calculista —</option>' +
          _calculistasCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
        if (calcVal) calcSel.value = calcVal;
      }
      var constSel = document.getElementById('recNuevoProjConstructora');
      if (constSel) {
        var constVal = constSel.value;
        constSel.innerHTML = '<option value="">— Sin constructora —</option>' +
          _clientesCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
        if (constVal) constSel.value = constVal;
      }
    }
  }
}

async function crearProyectoDesdeReclamo() {
  var nombre = document.getElementById('recNuevoProjNombre').value.trim();
  var msg = document.getElementById('recNuevoProjMsg');
  if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Creando...'; msg.style.color = '#666';
  var body = { nombre_proyecto: nombre };
  var calcId = document.getElementById('recNuevoProjCalculista').value;
  if (calcId) body.calculista_id = parseInt(calcId);
  var constId = document.getElementById('recNuevoProjConstructora').value;
  if (constId) body.constructora_id = parseInt(constId);
  var desc = document.getElementById('recNuevoProjDescripcion').value.trim();
  if (desc) body.descripcion = desc;
  var res = await fetch('/proyectos', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Obra creada'; msg.style.color = '#558B2F';
    document.getElementById('recNuevoProjNombre').value = '';
    document.getElementById('recNuevoProjCalculista').value = '';
    document.getElementById('recNuevoProjConstructora').value = '';
    document.getElementById('recNuevoProjDescripcion').value = '';
    await loadProyectos();
    await loadFilters();
    var sel = document.getElementById('recProyecto');
    if (sel && data.id_proyecto) sel.value = data.id_proyecto;
    toggleNuevoProyectoRec();
  } else {
    msg.textContent = 'Error: ' + (data.detail || data.error || 'desconocido'); msg.style.color = '#b42318';
  }
}

function toggleRecNewCalc() {
  var f = document.getElementById('recNewCalcForm');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearCalcDesdeRecForm() {
  var nombre = document.getElementById('recNewCalcNombre').value.trim();
  var msg = document.getElementById('recNewCalcMsg');
  if (!nombre) { msg.textContent = 'Ingresa un nombre'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Creando...'; msg.style.color = '#666';
  var res = await fetch('/calculistas', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: nombre })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Creado'; msg.style.color = '#558B2F';
    document.getElementById('recNewCalcNombre').value = '';
    await loadCalculistas();
    document.getElementById('recNuevoProjCalculista').value = data.id;
    document.getElementById('recNewCalcForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

function toggleRecNewConst() {
  var f = document.getElementById('recNewConstForm');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearConstDesdeRecForm() {
  var nombre = document.getElementById('recNewConstNombre').value.trim();
  var msg = document.getElementById('recNewConstMsg');
  if (!nombre) { msg.textContent = 'Ingresa un nombre'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Creando...'; msg.style.color = '#666';
  var res = await fetch('/constructoras', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: nombre })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Creada'; msg.style.color = '#558B2F';
    document.getElementById('recNewConstNombre').value = '';
    await loadClientes();
    document.getElementById('recNuevoProjConstructora').value = data.id;
    document.getElementById('recNewConstForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

function _populateReclamoDetailSelectors(data) {
  document.getElementById('recDetailAplica').value = data.aplica || 'pendiente';
  var idCalField = document.getElementById('recDetailIdCalidad');
  if (idCalField) idCalField.value = data.id_calidad || '';

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
  var titlePrefix = data.id_calidad ? data.id_calidad + ' — ' : (data.correlativo ? data.correlativo + ' — ' : '#' + data.id + ' — ');
  document.getElementById('recDetailTitle').textContent = titlePrefix + data.titulo;

  var metaParts = [];
  if (data.correlativo && data.id_calidad) metaParts.push(data.correlativo);
  if (data.nombre_proyecto) metaParts.push('Proyecto: ' + data.nombre_proyecto);
  metaParts.push('Creado por: ' + data.creado_por);
  if (data.fecha_creacion) metaParts.push(formatDateTime(data.fecha_creacion, ''));
  if (data.responsable) metaParts.push('Responsable: ' + data.responsable);
  if (data.detectado_por) metaParts.push('Detectado por: ' + data.detectado_por);
  if (data.asignado_a) metaParts.push('Subido por: ' + data.asignado_a);
  if (data.cubicador_asignado) metaParts.push('Cubicador: ' + data.cubicador_asignado);
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
  document.getElementById('recDetailValidacionResultado').value = data.validacion_resultado || '';
  document.getElementById('recDetailValidacionObs').value = data.validacion_observaciones || '';
  document.getElementById('recTiempoRespuesta').value = data.tiempo_respuesta || '';
  document.getElementById('recTiempoRespuestaUnidad').value = data.tiempo_respuesta_unidad || 'horas';

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
  var validado = !!data.validacion_resultado;

  var puedeEditarSec1 = (currentRole === 'admin' || currentRole === 'admin2') || (currentRole === 'usc' && esCreador);
  if (validado && currentRole !== 'admin') puedeEditarSec1 = false;
  var btnEditar = document.getElementById('btnEditarReclamo');
  if (btnEditar) btnEditar.style.display = puedeEditarSec1 ? '' : 'none';

  var selAplica = document.getElementById('recDetailAplica');
  if (selAplica) selAplica.disabled = !(['admin', 'admin2', 'cubicador'].includes(currentRole));

  var puedeEliminar = (currentRole === 'admin' || currentRole === 'admin2') || (currentRole === 'usc' && esCreador);
  var btnElim = document.getElementById('btnEliminarReclamo');
  if (btnElim) btnElim.style.display = puedeEliminar ? '' : 'none';

  var esAsignado = (currentRole === 'cubicador' && data.cubicador_asignado === currentUserEmail);
  var puedeCerrar = (currentRole === 'admin' || currentRole === 'admin2') || esAsignado;
  var cerrarCont = document.getElementById('recCerrarContainer');
  if (cerrarCont) cerrarCont.style.display = puedeCerrar ? '' : 'none';
  var estaCerrado = (data.estado === 'cerrado' || data.estado === 'rechazado');
  var puedeReabrir = estaCerrado && (currentRole === 'admin' || currentRole === 'admin2');
  var btnCerrar = document.getElementById('btnCerrarReclamo');
  var btnReabrir = document.getElementById('btnReabrirReclamo');
  if (btnCerrar) btnCerrar.style.display = estaCerrado ? 'none' : '';
  if (btnReabrir) btnReabrir.style.display = puedeReabrir ? '' : 'none';

  var idCalField = document.getElementById('recDetailIdCalidad');
  if (idCalField) idCalField.disabled = !puedeEditarSec1;

  var detProySel = document.getElementById('recDetailProyecto');
  if (detProySel) detProySel.disabled = !(currentRole === 'admin' || currentRole === 'admin2');

  var detAsigSel = document.getElementById('recDetailAsignadoA');
  if (detAsigSel) detAsigSel.disabled = !(currentRole === 'admin' || currentRole === 'admin2');

  var puedeResponder = ['admin','admin2','cubicador','externo'].includes(currentRole);
  if (validado && currentRole !== 'admin') puedeResponder = false;
  var sec2Fields = ['recDetailRespuestaTexto','recDetailCausaDisplay','recDetailAreaAplica','recDetailFechaAnalisis','recDetailKilosMal','recTiempoRespuestaAnalisis','recTiempoRespuestaUnidadAnalisis'];
  sec2Fields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeResponder; });
  var btnGuardarResp = document.getElementById('btnGuardarRespuesta');
  if (btnGuardarResp) btnGuardarResp.style.display = puedeResponder ? '' : 'none';
  var respDropZone = document.getElementById('recRespDropZone');
  var respFileInput = document.getElementById('recRespFileInput');
  if (respDropZone) respDropZone.style.display = puedeResponder ? '' : 'none';
  if (respFileInput) respFileInput.disabled = !puedeResponder;

  var puedeValidar = (currentRole === 'admin' || currentRole === 'admin2');
  var sec3Fields = ['recDetailValidacionResultado','recDetailValidacionObs','recTiempoRespuesta','recTiempoRespuestaUnidad'];
  sec3Fields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeValidar; });
  var btnGuardarVal = document.getElementById('btnGuardarValidacion');
  if (btnGuardarVal) btnGuardarVal.style.display = puedeValidar ? '' : 'none';

  var puedeAccion = ['admin','admin2','cubicador'].includes(currentRole);
  if (validado && currentRole !== 'admin') puedeAccion = false;
  var accionFields = ['recNuevaAccionTipo','recNuevaAccionDesc','recNuevaAccionResp','recNuevaAccionFecha'];
  accionFields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeAccion; });
}

function _renderReclamoDetail(data) {
  document.getElementById('reclamoDetailCard').style.display = '';
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
  document.getElementById('reclamoDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function verReclamo(id) {
  var data = await apiGet('/reclamos/' + id);
  if (!data) return;
  data = _normalizeReclamoDetail(data);
  _reclamoActual = data;
  _renderReclamoDetail(data);
}

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
  
  // Verificar que se haya seleccionado Aplica/No Aplica
  var aplicaSelect = document.getElementById('recDetailAplica');
  var aplicaValue = aplicaSelect ? aplicaSelect.value : _reclamoActual.aplica;
  
  if (!aplicaValue || aplicaValue === 'pendiente') {
    alert('Para cerrar el reclamo, primero debe seleccionar "Sí aplica" o "No aplica" en el campo Aplica.');
    return;
  }
  
  // Confirmación
  if (!confirm('¿Está seguro que desea cerrar este reclamo?\n\nUna vez cerrado, solo un administrador podrá reabrirlo para validación.')) {
    return;
  }
  
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'cerrado' })
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
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
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
    document.getElementById('recEditIdCalidad').value = d.id_calidad || '';
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
    // Populate responsable dropdown from cache (value=email)
    var sel = document.getElementById('recEditResponsable');
    sel.innerHTML = '<option value="">— Sin asignar —</option>';
    _recUsersCache.forEach(function(u) {
      sel.innerHTML += '<option value="' + u.email + '" data-display="' + u.display + '">' + u.display + ' (' + u.role + ')' + '</option>';
    });
    sel.value = d.cubicador_asignado || '';
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
  var puedeEditar = (currentRole === 'admin' || currentRole === 'admin2') || (currentRole === 'usc' && esCreador);
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
    id_calidad: document.getElementById('recEditIdCalidad').value.trim() || null,
    id_proyecto: editProyVal || null,
  };
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
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

async function guardarIdCalidad() {
  if (!_reclamoActual) return;
  var val = (document.getElementById('recDetailIdCalidad').value || '').trim();
  if (val === (_reclamoActual.id_calidad || '')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_calidad: val })
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
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
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
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
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
  var res = await fetch('/reclamos/usuarios-usc', { headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  
  // Update creation form dropdown
  var createSelect = document.getElementById('recAsignadoA');
  if (createSelect) {
    createSelect.innerHTML = '<option value="">— Auto-asignar —</option>';
    data.data.forEach(function(u) {
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
    data.data.forEach(function(u) {
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

async function cambiarAplicaReclamo() {
  if (!_reclamoActual) return;
  var val = document.getElementById('recDetailAplica').value;
  if (val === (_reclamoActual.aplica || 'pendiente')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ aplica: val })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); await loadRecLanding(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// ---- Respuesta del responsable (includes RCA) ----
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
    var res = await fetch('/reclamos/' + _reclamoActual.id, {
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
  
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = '✅ Validación guardada'; msg.style.color = '#558B2F';
    setTimeout(function() { msg.textContent = ''; }, 3000);
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
    responsable: formState.responsable, // Ahora es requerido, no null
    fecha_prevista: formState.fecha_prevista || null,
  };
  
  var res = await fetch('/reclamos/' + _reclamoActual.id + '/acciones', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    // Solo limpiar la descripción, preservar el resto del formulario
    document.getElementById('recNuevaAccionDesc').value = '';
    // Mantener responsable y otros campos para facilitar múltiples acciones similares
    // document.getElementById('recNuevaAccionResp').value = '';  // NO limpiar
    // document.getElementById('recNuevaAccionFecha').value = ''; // NO limpiar
    // document.getElementById('recNuevaAccionTipo').value = 'inmediata'; // NO limpiar
    
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
  var res = await fetch('/reclamos/' + _reclamoActual.id + '/acciones/' + accionId, {
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
  var result = await uploadFilesSequentially(files, {
    buildRequest: function(file) {
      var formData = new FormData();
      formData.append('file', file);
      formData.append('tipo', tipo);
      return {
        url: '/reclamos/' + _reclamoActual.id + '/imagenes',
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
  await verReclamo(_reclamoActual.id);
}

function initRecImageDropZones() {
  _initDropZone('recCreateDropZone', 'recCreateFileInput', _addCreatePreview);
  _initDropZone('recDetailDropZone', 'recDetailFileInput', function(files) { _uploadFilesWithTipo(files, 'antecedente', 'recImagenMsg'); });
  _initDropZone('recRespDropZone', 'recRespFileInput', function(files) { _uploadFilesWithTipo(files, 'respuesta', 'recRespImagenMsg'); });
}

async function eliminarImagen(imgId) {
  if (!_reclamoActual) return;
  if (!confirm('¿Eliminar esta imagen?')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id + '/imagenes/' + imgId, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); }
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
  var res = await fetch('/reclamos/' + _reclamoActual.id + '/seguimientos', {
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
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    _reclamoActual = null;
    document.getElementById('reclamoDetailCard').style.display = 'none';
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
  if (!_ishikawaData || !_ishikawaData.data) return;

  var grid = document.getElementById('ishikawaGrid');
  grid.innerHTML = _ishikawaData.data.map(function(cat) {
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

(function(global) {
  if (global.__armahubReclamosFeatureLoaded) {
    if (typeof global.__armahubResolveReclamosFeatureReady === 'function') {
      global.__armahubResolveReclamosFeatureReady(global.ArmaHubReclamosFeature || null);
      global.__armahubResolveReclamosFeatureReady = null;
      global.__armahubRejectReclamosFeatureReady = null;
    }
    return;
  }
  global.__armahubReclamosFeatureLoaded = true;

  var api = {};

  function resolveReady(value) {
    if (typeof global.__armahubResolveReclamosFeatureReady === 'function') {
      global.__armahubResolveReclamosFeatureReady(value);
      global.__armahubResolveReclamosFeatureReady = null;
      global.__armahubRejectReclamosFeatureReady = null;
    }
  }

  // --- Module entry point ---
  async function _loadReclamosModule() {
    if (typeof global.loadProyectos === 'function') {
      await Promise.resolve(global.loadProyectos());
    }
    await Promise.resolve(loadRecUsersDropdown());
    populateRecFilterProyecto();
    await Promise.resolve(loadReclamos());
    await Promise.resolve(loadRecLanding());
    _initRecImageDropZonesGuarded();
  }

  // --- Drop zones initializer with dedup guard ---
  function _initRecImageDropZonesGuarded() {
    if (global.__armahubReclamosDropZonesInitialized) return;
    initRecImageDropZones();
    // Solo marcar como inicializado si la zona principal existe en el DOM
    if (document.getElementById('recCreateDropZone')) {
      global.__armahubReclamosDropZonesInitialized = true;
    }
  }

  // --- Build API: all functions are file-scope, reference directly ---
  var allExports = [
    'switchRecTab',
    'loadRecLanding',
    'loadRecAdminDashboards',
    'loadRecUsersDropdown',
    'populateRecFilterProyecto',
    'loadReclamos',
    'limpiarFiltrosReclamos',
    'toggleNuevoReclamo',
    'crearReclamo',
    'toggleNuevoProyectoRec',
    'crearProyectoDesdeReclamo',
    'toggleRecNewCalc',
    'crearCalcDesdeRecForm',
    'toggleRecNewConst',
    'crearConstDesdeRecForm',
    'verReclamo',
    'renderAcciones',
    'renderImagenesEnContainer',
    'renderReclamoTimeline',
    'cerrarReclamo',
    'reabrirReclamo',
    'toggleEditarReclamo',
    'guardarEdicionReclamo',
    'guardarIdCalidad',
    'cambiarProyectoReclamo',
    'cambiarAsignadoAReclamo',
    'loadUsuariosUsc',
    'cambiarAplicaReclamo',
    'guardarRespuesta',
    'guardarValidacion',
    'agregarAccion',
    'limpiarFormularioAcciones',
    'eliminarAccion',
    'eliminarImagen',
    'agregarSeguimiento',
    'eliminarReclamo',
    'abrirIshikawaModal',
    'seleccionarIshikawa',
    'confirmarIshikawa',
    'cerrarIshikawaModal',
    'loadPresentaciones',
    'togglePresSection',
    'presNavPrev',
    'presNavNext',
    'seleccionarReclamoPres',
    'guardarPresentacion',
    'loadPresStats'
  ];

  allExports.forEach(function(name) {
    if (typeof global[name] === 'function') {
      api[name] = global[name];
    }
  });

  // Override wrapped versions
  api.loadReclamosModule = _loadReclamosModule;
  api.initRecImageDropZones = _initRecImageDropZonesGuarded;
  global.loadReclamosModule = _loadReclamosModule;
  global.initRecImageDropZones = _initRecImageDropZonesGuarded;

  global.ArmaHubReclamosFeature = api;
  resolveReady(api);
})(window);