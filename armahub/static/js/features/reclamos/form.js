// ArmaHub Reclamos — Form & Modal
// Split from index.js (PC.17.6)

// ---- Modal helpers (PC.8) ----
var _recModalTarget = null; // current element elevated to modal

function openReclamoModal(cardEl) {
  if (_recModalTarget) closeReclamoModal();
  var backdrop = document.getElementById('recModalBackdrop');
  if (backdrop) backdrop.classList.add('active');
  cardEl.classList.add('rec-modal-open');
  cardEl.style.display = '';
  var closeBtn = cardEl.querySelector('.rec-modal-close');
  if (closeBtn) closeBtn.style.display = '';
  _recModalTarget = cardEl;
  document.body.style.overflow = 'hidden';
  // Escape key to close
  document.addEventListener('keydown', _recModalEscHandler);
}

function closeReclamoModal() {
  if (!_recModalTarget) return;
  var backdrop = document.getElementById('recModalBackdrop');
  if (backdrop) backdrop.classList.remove('active');
  _recModalTarget.classList.remove('rec-modal-open');
  var closeBtn = _recModalTarget.querySelector('.rec-modal-close');
  if (closeBtn) closeBtn.style.display = 'none';
  // For detail card: hide it completely; for create form: hide the form
  if (_recModalTarget.id === 'reclamoDetailCard') {
    _recModalTarget.style.display = 'none';
  } else if (_recModalTarget.id === 'crearReclamoCard') {
    document.getElementById('nuevoReclamoForm').style.display = 'none';
    _recModalTarget.style.display = '';
    _recModalTarget.style.position = '';
  }
  _recModalTarget = null;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _recModalEscHandler);
}

function _recModalEscHandler(e) {
  // Don't close if Ishikawa or image viewer is open
  var ish = document.getElementById('ishikawaModal');
  if (ish && ish.style.display !== 'none') return;
  var iv = document.getElementById('imageModalViewer');
  if (iv && iv.style.display !== 'none') return;
  if (e.key === 'Escape') closeReclamoModal();
}

function toggleNuevoReclamo() {
  var card = document.getElementById('crearReclamoCard');
  var form = document.getElementById('nuevoReclamoForm');
  if (_recModalTarget === card) {
    closeReclamoModal();
    return;
  }
  form.style.display = '';
  openReclamoModal(card);
  // Auto-suggest año y numero calidad
  var anioField = document.getElementById('recAnioCalidad');
  if (anioField && !anioField.value) {
    var yr = new Date().getFullYear();
    anioField.value = yr;
    // anio_calidad: solo admin puede cambiar
    anioField.disabled = !(currentRole === 'admin' || currentRole === 'admin_calidad');
    _sugerirNumeroCalidad(yr, 'recNumeroCalidad');
  }
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
  var anioCalidad = document.getElementById('recAnioCalidad') ? parseInt(document.getElementById('recAnioCalidad').value) : null;
  var numeroCalidad = document.getElementById('recNumeroCalidad') ? parseInt(document.getElementById('recNumeroCalidad').value) : null;
  if (proyecto) body.id_proyecto = proyecto;
  if (tipoReclamo) body.tipo_reclamo = tipoReclamo;
  if (respEmail) { body.cubicador_asignado = respEmail; body.responsable = respDisplay || respEmail; }
  if (asignadoA) body.asignado_a = asignadoA;
  if (descripcion) body.descripcion = descripcion;
  if (detectadoPor) body.detectado_por = detectadoPor;
  if (fechaDeteccion) body.fecha_deteccion = fechaDeteccion;
  if (idCalidad) body.id_calidad = idCalidad;
  if (anioCalidad) body.anio_calidad = anioCalidad;
  if (numeroCalidad) body.numero_calidad = numeroCalidad;
  var res = await fetch(apiUrl('/reclamos'), {
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
        await fetch(apiUrl('/reclamos/' + data.id + '/imagenes'), { method: 'POST', headers: authHeaders(), body: formData });
      }
    }
    _recCreateStagedFiles = [];
    msg.textContent = label + ' registrado correctamente'; msg.style.color = '#558B2F';
    ['recTitulo','recDescripcion','recResponsable','recAsignadoA','recDetectadoPor','recFechaDeteccion','recIdCalidad','recAnioCalidad','recNumeroCalidad'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('recProyecto').value = '';
    document.getElementById('recCreatePreview').innerHTML = '';
    document.getElementById('recCreateDropMsg').style.display = '';
    closeReclamoModal();
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
  var res = await fetch(apiUrl('/proyectos'), {
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
  var res = await fetch(apiUrl('/calculistas'), {
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
  var res = await fetch(apiUrl('/constructoras'), {
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
