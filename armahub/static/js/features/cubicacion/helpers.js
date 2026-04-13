// ========================= CUBICACIÓN — Helpers compartidos (E.4) =========================
// Calculista select, modales de proyecto nuevo/faltante, typeahead.

// ========================= CALCULISTA SELECT HELPER =========================
function populateCalcSelect(selId) {
  var sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sin calculista —</option>' +
    _calculistasCache.map(function(c) { return '<option value="' + c.nombre + '">' + c.nombre + '</option>'; }).join('') +
    '<option value="__otro__">+ Otro (escribir)</option>';
}

function toggleCalcInput(prefix) {
  var sel = document.getElementById(prefix + 'CalculistaSelect');
  var inp = document.getElementById(prefix + 'CalculistaInput');
  var hidden = document.getElementById(prefix + 'Calculista');
  if (sel.value === '__otro__') {
    inp.style.display = '';
    inp.focus();
    hidden.value = '';
  } else {
    inp.style.display = 'none';
    inp.value = '';
    hidden.value = sel.value;
  }
}

function syncCalcHidden(prefix) {
  var sel = document.getElementById(prefix + 'CalculistaSelect');
  var inp = document.getElementById(prefix + 'CalculistaInput');
  var hidden = document.getElementById(prefix + 'Calculista');
  if (sel.value === '__otro__') {
    hidden.value = inp.value.trim();
  } else {
    hidden.value = sel.value;
  }
}

// ========================= NEW PROJECT MODAL =========================
let _newProjResolve = null;

async function openNewProjectModal(data) {
  document.getElementById('newProjMsg').textContent = data.mensaje || '';
  document.getElementById('newProjNombre').value = data.proyecto_nombre || '';
  var idInfo = document.getElementById('newProjIdInfo');
  if (idInfo) idInfo.textContent = 'Código del CSV: ' + (data.proyecto_id || '?');
  // Store CSV project ID for assign flow
  window._newProjCsvId = data.proyecto_id || '';

  populateCalcSelect('newProjCalculistaSelect');
  document.getElementById('newProjCalculistaSelect').value = '';
  document.getElementById('newProjCalculistaInput').style.display = 'none';
  document.getElementById('newProjCalculistaInput').value = '';
  document.getElementById('newProjCalculista').value = '';

  // Populate 'assign to existing obra' dropdown
  var asigSel = document.getElementById('newProjAsignarA');
  if (asigSel) {
    asigSel.innerHTML = '<option value="">— Selecciona una obra —</option>';
    if (data.obras_existentes && data.obras_existentes.length > 0) {
      data.obras_existentes.forEach(function(o) {
        asigSel.innerHTML += '<option value="' + o.id_proyecto + '">' + o.nombre_proyecto + ' (' + o.id_proyecto + ')</option>';
      });
    }
  }

  // Populate client selector
  var clSel = document.getElementById('newProjCliente');
  if (clSel) {
    clSel.innerHTML = '<option value="">— Sin constructora —</option>' +
      _clientesCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
  }

  showModal('newProjectModal');

  return new Promise(resolve => { _newProjResolve = resolve; });
}

function closeNewProjectModal(action) {
  if (!_newProjResolve) return;
  if (action === 'assign') {
    var asigVal = document.getElementById('newProjAsignarA').value;
    if (!asigVal) { alert('Selecciona una obra para asignar'); return; }
    hideModal('newProjectModal');
    _newProjResolve({
      confirmed: true,
      assign_to: asigVal,
      csv_proyecto_id: window._newProjCsvId || '',
    });
    _newProjResolve = null;
  } else if (action === true) {
    var nombre = document.getElementById('newProjNombre').value.trim();
    if (!nombre) { alert('Ingresa un nombre para el proyecto'); return; }
    syncCalcHidden('newProj');
    hideModal('newProjectModal');
    _newProjResolve({
      confirmed: true,
      calculista: document.getElementById('newProjCalculista').value.trim(),
      owner_id: document.getElementById('newProjOwner').value || '',
      constructora_id: document.getElementById('newProjCliente') ? document.getElementById('newProjCliente').value : '',
      nombre_override: nombre,
    });
    _newProjResolve = null;
  } else {
    hideModal('newProjectModal');
    _newProjResolve({ confirmed: false });
    _newProjResolve = null;
  }
}

// ========================= MISSING PROJECT MODAL =========================
let _missProjResolve = null;

async function openMissingProjectModal(data) {
  document.getElementById('missProjMsg').textContent = data.mensaje || '';
  document.getElementById('missProjNombre').value = '';
  populateCalcSelect('missProjCalculistaSelect');
  document.getElementById('missProjCalculistaSelect').value = '';
  document.getElementById('missProjCalculistaInput').style.display = 'none';
  document.getElementById('missProjCalculistaInput').value = '';
  document.getElementById('missProjCalculista').value = '';

  // Populate existing projects dropdown (copy from any loaded project selector)
  var projSel = document.getElementById('missProjExistente');
  var srcProj = document.getElementById('pedidoProyecto') || document.getElementById('recProyecto');
  if (projSel && srcProj) {
    projSel.innerHTML = '<option value="">— Selecciona un proyecto —</option>' + 
      Array.from(srcProj.options).filter(function(o) { return o.value; }).map(function(o) {
        return '<option value="' + o.value + '">' + o.textContent + '</option>';
      }).join('');
  }

  // Load users for owner select
  var owSel = document.getElementById('missProjOwner');
  if (owSel) {
    owSel.innerHTML = '<option value="">Cargando...</option>';
    var usersData = await apiGet('/users/list');
    if (usersData && usersData.users) {
      var me = localStorage.getItem('armahub_email') || '';
      owSel.innerHTML = usersData.users.map(function(u) {
        return '<option value="' + u.id + '"' + (u.email === me ? ' selected' : '') + '>' + u.email + ' (' + u.role + ')</option>';
      }).join('');
    }
  }

  // Populate client selector
  var clSel = document.getElementById('missProjCliente');
  if (clSel) {
    clSel.innerHTML = '<option value="">— Sin constructora —</option>' +
      _clientesCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
  }

  showModal('missingProjectModal');
  return new Promise(function(resolve) { _missProjResolve = resolve; });
}

function closeMissingProjectModal(action) {
  hideModal('missingProjectModal');
  if (!_missProjResolve) return;
  if (action === 'existing') {
    var projId = document.getElementById('missProjExistente').value;
    if (!projId) { alert('Selecciona un proyecto'); showModal('missingProjectModal'); return; }
    _missProjResolve({ action: 'existing', proyecto_id: projId });
  } else if (action === 'new') {
    var nombre = document.getElementById('missProjNombre').value.trim();
    if (!nombre) { alert('Ingresa un nombre para el proyecto'); showModal('missingProjectModal'); return; }
    syncCalcHidden('missProj');
    _missProjResolve({
      action: 'new',
      nombre: nombre,
      calculista: document.getElementById('missProjCalculista').value.trim(),
      owner_id: document.getElementById('missProjOwner').value || '',
      constructora_id: document.getElementById('missProjCliente').value || '',
    });
  } else {
    _missProjResolve({ action: 'cancel' });
  }
  _missProjResolve = null;
}

// Typeahead filter: filters <select> options by text typed in a search input
function filterProjectSelect(inputId, selectId) {
  const q = document.getElementById(inputId).value.toLowerCase().trim();
  const sel = document.getElementById(selectId);
  for (let i = 0; i < sel.options.length; i++) {
    const opt = sel.options[i];
    if (i === 0) { opt.style.display = ''; continue; } // always show first (placeholder)
    opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
  }
  // If current selection is hidden, reset to first option
  if (sel.selectedIndex > 0 && sel.options[sel.selectedIndex].style.display === 'none') {
    sel.selectedIndex = 0;
  }
  // If only one visible option (besides placeholder), auto-select it
  const visible = Array.from(sel.options).filter((o, i) => i > 0 && o.style.display !== 'none');
  if (visible.length === 1) {
    visible[0].selected = true;
    sel.dispatchEvent(new Event('change'));
  }
}
