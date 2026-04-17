// ArmaHub Reclamos — Helpers & Normalizers
// Split from index.js (PC.17.2)

function _calcDiasReclamo(r) {
  if (!r.fecha_creacion) return null;
  var creacion = r.fecha_creacion.substring(0, 10);
  // Reclamos anteriores al corte: contar desde fecha operativa
  var inicio = creacion < _FECHA_OPERATIVA ? new Date(_FECHA_OPERATIVA) : new Date(creacion);
  var fin = r.fecha_cierre ? new Date(r.fecha_cierre.substring(0, 10)) : new Date();
  // Truncar fin a medianoche para evitar redondeo por hora actual
  fin.setHours(0, 0, 0, 0);
  var dias = Math.floor((fin - inicio) / 86400000);
  return dias < 0 ? 0 : dias;
}

function _diasHeatColor(dias) {
  if (dias === null) return '';
  if (dias <= 3) return '#4CAF50';
  if (dias <= 7) return '#8BC34A';
  if (dias <= 14) return '#FFC107';
  if (dias <= 21) return '#FF9800';
  if (dias <= 30) return '#FF5722';
  return '#B71C1C';
}

function _diasBadgeHtml(r) {
  var dias = _calcDiasReclamo(r);
  if (dias === null) return '<span style="color:#ccc; font-size:10px;">—</span>';
  var color = _diasHeatColor(dias);
  return '<span title="' + dias + ' día(s) desde creación" style="display:inline-block; min-width:28px; text-align:center; padding:1px 5px; border-radius:3px; font-size:10px; font-weight:700; color:#fff; background:' + color + ';">' + dias + 'd</span>';
}

function _normalizeReclamoDateInputValue(value) {
  return formatDateInput(value);
}

function _formatCorrelativoCalidad(r) {
  if (r.anio_calidad && r.numero_calidad) return r.anio_calidad + '-' + String(r.numero_calidad).padStart(3, '0');
  if (r.numero_calidad) return String(r.numero_calidad).padStart(3, '0');
  return r.id_calidad || '';
}

async function _sugerirNumeroCalidad(anio, targetId) {
  if (!anio) return;
  try {
    var res = await fetch(apiUrl('/reclamos/siguiente-numero-calidad?anio=' + anio), { headers: authHeaders() });
    if (res.ok) {
      var data = await res.json();
      var field = document.getElementById(targetId);
      if (field && !field.value) field.value = data.siguiente;
    }
  } catch(e) {}
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
