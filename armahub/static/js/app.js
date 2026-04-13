// ArmaHub — Main Application JavaScript
// Extracted from ui.py for maintainability

// ========================= ESTILOS PARA LAZY LOADING =========================
// Inyectar CSS para animación de loading
if (!document.getElementById('lazyLoadingStyles')) {
  var style = document.createElement('style');
  style.id = 'lazyLoadingStyles';
  style.textContent = `
    @keyframes loading {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(style);
}

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
  if (idInfo) idInfo.textContent = 'C\u00f3digo del CSV: ' + (data.proyecto_id || '?');
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
    asigSel.innerHTML = '<option value="">\u2014 Selecciona una obra \u2014</option>';
    if (data.obras_existentes && data.obras_existentes.length > 0) {
      data.obras_existentes.forEach(function(o) {
        asigSel.innerHTML += '<option value="' + o.id_proyecto + '">' + o.nombre_proyecto + ' (' + o.id_proyecto + ')</option>';
      });
    }
  }

  // Populate client selector
  var clSel = document.getElementById('newProjCliente');
  if (clSel) {
    clSel.innerHTML = '<option value="">\u2014 Sin constructora \u2014</option>' +
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
    projSel.innerHTML = '<option value="">\u2014 Selecciona un proyecto \u2014</option>' + 
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
    clSel.innerHTML = '<option value="">\u2014 Sin constructora \u2014</option>' +
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

async function loadMe() {
  const me = await loadCurrentSession();
  if (!me) return;

  if (typeof window.renderHubModules === 'function') {
    window.renderHubModules();
  }

  // Show Hub screen
  document.getElementById('hubScreen').style.display = 'block';

  // Status message
  const roleLabels = {admin:'ADMIN', admin2:'Admin2', cubicador:'Cubicador', usc:'USC', externo:'Externo', cliente:'Cliente'};
  await setGlobalStatus("Sesión como " + (roleLabels[currentRole] || currentRole), "ok");

  // Load landing flash indicators
  loadLandingIndicadores();
}

async function loadCubicacionModule() {
  await loadInicio();
  await loadMiActividad();
  await loadProyectos();
  await loadClientes();
  await loadCalculistas();

  var saved = typeof restoreFiltersFromStorage === 'function' ? restoreFiltersFromStorage() : null;
  var dep = {};
  if (saved && saved.proyecto) {
    dep.proyecto = saved.proyecto;
  }
  await loadFilters(Object.keys(dep).length ? dep : null);

  if (saved) {
    ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].forEach(function(field) {
      var element = document.getElementById(field);
      if (element && saved[field]) {
        element.value = saved[field];
      }
    });
    if (saved.proyecto) {
      await loadCargasDropdown(saved.proyecto);
    }
    if (saved.filtroCarga) {
      var filtroCarga = document.getElementById('filtroCarga');
      if (filtroCarga) {
        filtroCarga.value = saved.filtroCarga;
      }
    }
  }

  await loadCargas();
  await loadDashboard('sector');
  await loadSectores();
  await loadPedidos();
  await buscar(true);
}

async function waitForReclamosFeatureReady() {
  var featureReady = window.__armahubReclamosFeatureReady;
  if (featureReady && typeof featureReady.then === 'function') {
    try {
      await featureReady;
    } catch (error) {
      console.warn('[ArmaHub] Reclamos feature unavailable, using legacy fallback.', error);
    }
  }
}

async function loadReclamosModule() {
  await waitForReclamosFeatureReady();
  if (
    window.ArmaHubReclamosFeature &&
    typeof window.ArmaHubReclamosFeature.loadReclamosModule === 'function' &&
    window.ArmaHubReclamosFeature.loadReclamosModule !== loadReclamosModule
  ) {
    return window.ArmaHubReclamosFeature.loadReclamosModule();
  }
  await loadProyectos();
  await loadRecUsersDropdown();
  populateRecFilterProyecto();
  await loadReclamos();
  await loadRecLanding();
  initRecImageDropZones();
}

async function loadAdminModule() {
  await loadUsers();
  await loadClientes();
  await loadCalculistas();
  await loadAdminProyectos();
  await loadTableCounts();
  await loadDbInfo();
  await loadAuditLog();
}

// Store proyectos data globally for filtering
var _proyectosData = [];

async function loadProyectos() {
  const data = await apiGet('/proyectos');
  if (!data) return;
  
  _proyectosData = data.proyectos || [];
  renderProyectosTable(_proyectosData);

  // Populate export project filter
  const epf = document.getElementById('exportProyecto');
  const prevE = epf.value;
  epf.innerHTML = '<option value="">-- Selecciona proyecto --</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prevE) epf.value = prevE;

  // Populate sector constructivo project filter
  const spf = document.getElementById('sectorProyectoFilter');
  const prev = spf.value;
  spf.innerHTML = '<option value="">Todos los proyectos</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prev) spf.value = prev;

  // Populate matriz constructiva project filter
  const mpf = document.getElementById('matrizProyectoFilter');
  const prevM = mpf.value;
  mpf.innerHTML = '<option value="">\u2014 Selecciona un proyecto \u2014</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prevM) mpf.value = prevM;

  // Populate navegador sectores project filter
  const npf = document.getElementById('navProyectoFilter');
  const prevN = npf.value;
  npf.innerHTML = '<option value="">\u2014 Selecciona proyecto \u2014</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prevN) npf.value = prevN;

  // Populate pedidos project filter
  const ppf = document.getElementById('pedidoProyecto');
  const prevP = ppf.value;
  ppf.innerHTML = '<option value="">\u2014 Selecciona proyecto \u2014</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prevP) ppf.value = prevP;

  // Populate reclamos project filter
  const rpf = document.getElementById('recProyecto');
  if (rpf) {
    const prevR = rpf.value;
    rpf.innerHTML = '<option value="">\u2014 Sin proyecto \u2014</option>' +
      data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
    if (prevR) rpf.value = prevR;
  }

}

function filterProyectos() {
  var search = (document.getElementById('proyectoSearchInput').value || '').toLowerCase().trim();
  if (!search) {
    renderProyectosTable(_proyectosData);
    return;
  }
  var filtered = _proyectosData.filter(function(p) {
    return (p.nombre_proyecto || '').toLowerCase().includes(search) ||
           (p.cubicador || '').toLowerCase().includes(search) ||
           (p.id_proyecto || '').toLowerCase().includes(search);
  });
  renderProyectosTable(filtered);
}

function renderProyectosTable(proyectos) {
  var container = document.getElementById('proyectosContainer');
  if (!proyectos || proyectos.length === 0) {
    container.innerHTML = '<div class="muted">No hay proyectos cargados</div>';
    return;
  }
  
  // Group by year (from fecha_inicio or fecha_creacion)
  var byYear = {};
  proyectos.forEach(function(p) {
    var dateStr = p.fecha_inicio || p.fecha_creacion || '';
    var year = dateStr ? dateStr.substring(0, 4) : 'Sin fecha';
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(p);
  });
  
  // Sort years descending (newest first for year headers, but projects sorted oldest first within)
  var years = Object.keys(byYear).sort().reverse();
  
  var html = '<div style="overflow-x:auto;">';
  html += '<table style="width:100%; border-collapse:collapse; font-size:12px;">';
  html += '<thead><tr style="background:#f5f5f5;">';
  html += '<th style="padding:8px 6px; text-align:left; border-bottom:2px solid #ddd; width:30px;"></th>';
  html += '<th style="padding:8px 6px; text-align:left; border-bottom:2px solid #ddd;">Proyecto</th>';
  html += '<th style="padding:8px 6px; text-align:left; border-bottom:2px solid #ddd;">Cubicador</th>';
  html += '<th style="padding:8px 6px; text-align:right; border-bottom:2px solid #ddd;">Kilos</th>';
  html += '<th style="padding:8px 6px; text-align:right; border-bottom:2px solid #ddd;">Ø</th>';
  html += '<th style="padding:8px 6px; text-align:right; border-bottom:2px solid #ddd;">PPI</th>';
  html += '<th style="padding:8px 6px; text-align:center; border-bottom:2px solid #ddd;">Acciones</th>';
  html += '</tr></thead><tbody>';
  
  years.forEach(function(year) {
    // Year header row
    html += '<tr style="background:#e8f5e9;">';
    html += '<td colspan="7" style="padding:6px 8px; font-weight:bold; color:#2e7d32; font-size:13px;">📅 ' + year + '</td>';
    html += '</tr>';
    
    byYear[year].forEach(function(p) {
      var safeId = p.id_proyecto.replace(/[^a-zA-Z0-9_-]/g, '_');
      var kilosStr = formatInteger(p.total_kilos, '0');
      var diamStr = p.diam_prom ? formatDecimal(p.diam_prom, 1, '-') : '-';
      var ppiStr = p.ppi ? formatDecimal(p.ppi, 1, '-') : '-';
      
      html += '<tr class="proyecto-row" data-id="' + p.id_proyecto + '" style="border-bottom:1px solid #eee;">';
      html += '<td style="padding:6px; text-align:center; cursor:pointer;" onclick="toggleProyectoTree(\'' + safeId + '\')"><span id="arrow-' + safeId + '">▸</span></td>';
      html += '<td style="padding:6px;"><strong>' + (p.nombre_proyecto || p.id_proyecto) + '</strong></td>';
      html += '<td style="padding:6px; color:#666;">' + (p.cubicador || '-') + '</td>';
      html += '<td style="padding:6px; text-align:right; font-weight:500;">' + kilosStr + ' kg</td>';
      html += '<td style="padding:6px; text-align:right; color:#666;">' + diamStr + '</td>';
      html += '<td style="padding:6px; text-align:right; color:#666;">' + ppiStr + '</td>';
      html += '<td style="padding:6px; text-align:center; white-space:nowrap;">';
      html += '<button class="secondary" style="font-size:10px; padding:3px 6px; margin:0 2px;" onclick="toggleCargasProyecto(\'' + p.id_proyecto.replace(/'/g, "\\'") + '\')">Historial</button>';
      html += '<button class="secondary" style="font-size:10px; padding:3px 6px; margin:0 2px;" onclick="openInfoProyectoModal(\'' + p.id_proyecto.replace(/'/g, "\\'") + '\')">Info</button>';
      html += '<button class="secondary" style="font-size:10px; padding:3px 6px; margin:0 2px;" onclick="openEditObraModal(\'' + p.id_proyecto.replace(/'/g, "\\'") + '\')">Editar</button>';
      html += '</td>';
      html += '</tr>';
      
      // Expandable tree row (hidden by default)
      html += '<tr id="tree-' + safeId + '" style="display:none;">';
      html += '<td colspan="7" style="padding:0 0 0 20px; background:#fafafa;">';
      html += '<div id="tree-content-' + safeId + '" class="muted" style="padding:10px; font-size:11px;">Cargando estructura...</div>';
      html += '</td>';
      html += '</tr>';
      
      // Cargas panel row (hidden by default)
      html += '<tr id="cargas-row-' + safeId + '" style="display:none;">';
      html += '<td colspan="7" style="padding:10px 20px; background:#fff8e1; border-left:3px solid #ffc107;">';
      html += '<div style="font-size:12px; font-weight:bold; margin-bottom:6px;">Historial de cargas</div>';
      html += '<div id="cargas-list-' + p.id_proyecto + '" class="muted" style="font-size:12px;">Cargando...</div>';
      html += '</td>';
      html += '</tr>';
    });
  });
  
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function toggleProyectoTree(safeId) {
  var treeRow = document.getElementById('tree-' + safeId);
  var arrow = document.getElementById('arrow-' + safeId);
  var content = document.getElementById('tree-content-' + safeId);
  
  if (!treeRow || !arrow || !content) return;
  
  if (treeRow.style.display === 'none') {
    treeRow.style.display = '';
    arrow.textContent = '▾';
    
    // Find the proyecto
    var idProyecto = null;
    var rows = document.querySelectorAll('.proyecto-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dataset.id && rows[i].dataset.id.replace(/[^a-zA-Z0-9_-]/g, '_') === safeId) {
        idProyecto = rows[i].dataset.id;
        break;
      }
    }
    
    if (idProyecto && content.innerHTML.includes('Cargando')) {
      content.innerHTML = '<div style="padding:10px;"><span class="muted">⏳ Cargando estructura...</span></div>';
      try {
        var data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/sectores-nav');
        if (data && data.pisos && data.pisos.length > 0) {
          renderProyectoTree(content, data.pisos, idProyecto);
        } else {
          content.innerHTML = '<div style="padding:10px;"><span class="muted">Sin datos cargados</span></div>';
        }
      } catch (e) {
        console.error('Error loading tree:', e);
        content.innerHTML = '<div style="padding:10px;"><span style="color:#b42318;">Error cargando estructura</span></div>';
      }
    }
  } else {
    treeRow.style.display = 'none';
    arrow.textContent = '▸';
  }
}

function renderProyectoTree(container, pisos, idProyecto) {
  if (!pisos || pisos.length === 0) {
    container.innerHTML = '<span class="muted">Sin datos</span>';
    return;
  }
  
  var html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  html += '<thead><tr style="background:#f0f0f0;">';
  html += '<th style="padding:4px 6px; text-align:left;">Piso / Ciclo / Sector</th>';
  html += '<th style="padding:4px 6px; text-align:right;">Kilos</th>';
  html += '<th style="padding:4px 6px; text-align:right;">Barras</th>';
  html += '<th style="padding:4px 6px; text-align:center;">Ver</th>';
  html += '</tr></thead><tbody>';
  
  pisos.forEach(function(p) {
    var pisoId = (idProyecto + '_' + p.piso).replace(/[^a-zA-Z0-9_-]/g, '_');
    html += '<tr style="background:#e3f2fd; cursor:pointer;" onclick="toggleSectorPisos(\'' + pisoId + '\')">'; 
    html += '<td style="padding:4px 6px; font-weight:bold;"><span id="sarrow-' + pisoId + '">▸</span> ' + (p.piso || '?') + '</td>';
    html += '<td style="padding:4px 6px; text-align:right; font-weight:500;">' + Math.round(p.kilos).toLocaleString() + ' kg</td>';
    html += '<td style="padding:4px 6px; text-align:right;">' + p.barras + '</td>';
    html += '<td style="padding:4px 6px; text-align:center;"><button class="secondary" style="font-size:9px; padding:2px 5px;" onclick="event.stopPropagation(); goToBarManager(\'' + idProyecto.replace(/'/g, "\\'") + '\', \'\', \'' + (p.piso || '').replace(/'/g, "\\'") + '\', \'\')">🔍</button></td>';
    html += '</tr>';
    
    // Ciclos (hidden by default)
    html += '<tr id="pisos-' + pisoId + '" style="display:none;"><td colspan="4" style="padding:0;">';
    html += '<table style="width:100%; border-collapse:collapse;">';
    
    (p.ciclos || []).forEach(function(c) {
      var cicloId = pisoId + '_' + (c.ciclo || '').replace(/[^a-zA-Z0-9_-]/g, '_');
      html += '<tr style="background:#fff; cursor:pointer;" onclick="togglePisoCiclos(\'' + cicloId + '\')">'; 
      html += '<td style="padding:3px 6px 3px 20px;"><span id="parrow-' + cicloId + '">▸</span> ' + (c.ciclo || '?') + '</td>';
      html += '<td style="padding:3px 6px; text-align:right;">' + Math.round(c.kilos).toLocaleString() + ' kg</td>';
      html += '<td style="padding:3px 6px; text-align:right;">' + c.barras + '</td>';
      html += '<td style="padding:3px 6px; text-align:center;"><button class="secondary" style="font-size:9px; padding:2px 5px;" onclick="event.stopPropagation(); goToBarManager(\'' + idProyecto.replace(/'/g, "\\'") + '\', \'\', \'' + (p.piso || '').replace(/'/g, "\\'") + '\', \'' + (c.ciclo || '').replace(/'/g, "\\'") + '\')">🔍</button></td>';
      html += '</tr>';
      
      // Sectores (hidden by default)
      html += '<tr id="ciclos-' + cicloId + '" style="display:none;"><td colspan="4" style="padding:0;">';
      html += '<table style="width:100%; border-collapse:collapse;">';
      
      (c.sectores || []).forEach(function(s) {
        html += '<tr style="background:#fafafa;">';
        html += '<td style="padding:2px 6px 2px 40px; color:#666;">' + (s.sector || '?') + '</td>';
        html += '<td style="padding:2px 6px; text-align:right; color:#666;">' + Math.round(s.kilos).toLocaleString() + ' kg</td>';
        html += '<td style="padding:2px 6px; text-align:right; color:#666;">' + s.barras + '</td>';
        html += '<td style="padding:2px 6px; text-align:center;"><button class="secondary" style="font-size:9px; padding:2px 5px;" onclick="goToBarManager(\'' + idProyecto.replace(/'/g, "\\'") + '\', \'' + (s.sector || '').replace(/'/g, "\\'") + '\', \'' + (p.piso || '').replace(/'/g, "\\'") + '\', \'' + (c.ciclo || '').replace(/'/g, "\\'") + '\')">🔍</button></td>';
        html += '</tr>';
      });
      
      html += '</table></td></tr>';
    });
    
    html += '</table></td></tr>';
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

function toggleSectorPisos(sectorId) {
  var row = document.getElementById('pisos-' + sectorId);
  var arrow = document.getElementById('sarrow-' + sectorId);
  if (row.style.display === 'none') {
    row.style.display = '';
    arrow.textContent = '▾';
  } else {
    row.style.display = 'none';
    arrow.textContent = '▸';
  }
}

function togglePisoCiclos(pisoId) {
  var row = document.getElementById('ciclos-' + pisoId);
  var arrow = document.getElementById('parrow-' + pisoId);
  if (row.style.display === 'none') {
    row.style.display = '';
    arrow.textContent = '▾';
  } else {
    row.style.display = 'none';
    arrow.textContent = '▸';
  }
}

function goToBarManager(idProyecto, sector, piso, ciclo) {
  // Switch to bar manager tab and apply filters
  switchTab('bar-manager');
  setTimeout(function() {
    var projSel = document.getElementById('barProyectoFilter');
    if (projSel) projSel.value = idProyecto;
    var secSel = document.getElementById('barSectorFilter');
    if (secSel) secSel.value = sector || '';
    var pisoSel = document.getElementById('barPisoFilter');
    if (pisoSel) pisoSel.value = piso || '';
    var cicloSel = document.getElementById('barCicloFilter');
    if (cicloSel) cicloSel.value = ciclo || '';
    if (typeof loadBarras === 'function') loadBarras();
  }, 100);
}

// Modal functions
function openCrearObraModal() {
  showModal('crearObraModal');
  document.getElementById('newObraName').value = '';
  document.getElementById('newObraDescripcion').value = '';
  document.getElementById('crearObraMsg').innerHTML = '';
  populateCalcSelect('newObraCalculista');
  populateConstSelect('newObraCliente');
}

function closeCrearObraModal() {
  hideModal('crearObraModal');
}

async function openInfoProyectoModal(idProyecto) {
  showModal('infoProyectoModal');
  var content = document.getElementById('infoProyectoContent');
  content.innerHTML = '<div class="muted">Cargando...</div>';
  
  // Find proyecto in cached data
  var p = _proyectosData.find(function(x) { return x.id_proyecto === idProyecto; });
  if (!p) {
    content.innerHTML = '<div class="muted">Proyecto no encontrado</div>';
    return;
  }
  
  document.getElementById('infoProyectoTitle').textContent = p.nombre_proyecto || idProyecto;
  
  // Get autorizados
  var authData = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizados');
  var autorizados = authData && authData.autorizados ? authData.autorizados : [];
  
  var html = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13px;">';
  html += '<div><strong>ID Proyecto:</strong> ' + p.id_proyecto + '</div>';
  html += '<div><strong>Kilos totales:</strong> ' + formatKilos(p.total_kilos, 0, '-') + '</div>';
  html += '<div><strong>Barras totales:</strong> ' + p.total_barras.toLocaleString() + '</div>';
  html += '<div><strong>Diámetro promedio:</strong> ' + (p.diam_prom || '-') + ' mm</div>';
  html += '<div><strong>PPI:</strong> ' + (p.ppi ? formatDecimal(p.ppi, 2, '-') : '-') + ' kg/barra</div>';
  html += '<div><strong>Fecha creación:</strong> ' + formatDateShort(p.fecha_creacion, '-') + '</div>';
  html += '<div><strong>Fecha inicio:</strong> ' + formatDateShort(p.fecha_inicio, '-') + '</div>';
  html += '<div><strong>Creado por:</strong> ' + (p.usuario_creador || '-') + '</div>';
  html += '<div><strong>Calculista:</strong> ' + (p.calculista_nombre || '-') + '</div>';
  html += '<div><strong>Constructora:</strong> ' + (p.constructora_nombre || '-') + '</div>';
  html += '</div>';
  
  html += '<div style="margin-top:16px;"><strong>Usuarios asignados:</strong></div>';
  if (autorizados.length === 0) {
    html += '<div class="muted" style="margin-top:4px;">Sin usuarios adicionales</div>';
  } else {
    html += '<div style="margin-top:4px;">';
    autorizados.forEach(function(u) {
      html += '<span class="badge" style="margin:2px;">' + (u.nombre || u.email) + ' (' + u.rol + ')</span>';
    });
    html += '</div>';
  }
  
  if (p.aliases && p.aliases.length > 0) {
    html += '<div style="margin-top:12px;"><strong>Códigos ArmaDetailer asociados:</strong></div>';
    html += '<div style="margin-top:4px;">' + p.aliases.map(function(a) { return '<span class="badge">' + a + '</span>'; }).join(' ') + '</div>';
  }
  
  content.innerHTML = html;
}

function closeInfoProyectoModal() {
  hideModal('infoProyectoModal');
}

// ========================= ADMIN OBRAS =========================
var _editObraCurrentId = null;

async function crearObra() {
  const name = document.getElementById('newObraName').value.trim();
  const calcSel = document.getElementById('newObraCalculista');
  const calcId = calcSel ? calcSel.value : '';
  const clienteSel = document.getElementById('newObraCliente');
  const clienteId = clienteSel ? clienteSel.value : '';
  const descEl = document.getElementById('newObraDescripcion');
  const msg = document.getElementById('crearObraMsg');
  if (!name) { msg.innerHTML = '<span class="status-err">Ingresa un nombre para la obra</span>'; return; }
  msg.innerHTML = '<span class="muted">Creando...</span>';
  const body = { nombre_proyecto: name };
  if (calcId) body.calculista_id = parseInt(calcId);
  if (clienteId) body.constructora_id = parseInt(clienteId);
  if (descEl && descEl.value.trim()) body.descripcion = descEl.value.trim();
  const res = await fetch('/proyectos', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    closeCrearObraModal();
    await setGlobalStatus('✅ Obra creada: ' + data.nombre_proyecto, 'ok');
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    await loadMiActividad();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || data.error || 'desconocido') + '</span>';
  }
}

function toggleObraNewCalc() {
  var f = document.getElementById('obraNewCalcForm');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearCalcDesdeObraForm() {
  var nombre = document.getElementById('obraNewCalcNombre').value.trim();
  var msg = document.getElementById('obraNewCalcMsg');
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
    document.getElementById('obraNewCalcNombre').value = '';
    await loadCalculistas();
    document.getElementById('newObraCalculista').value = data.id;
    document.getElementById('obraNewCalcForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

function toggleObraNewConst() {
  var f = document.getElementById('obraNewConstForm');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearConstDesdeObraForm() {
  var nombre = document.getElementById('obraNewConstNombre').value.trim();
  var msg = document.getElementById('obraNewConstMsg');
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
    document.getElementById('obraNewConstNombre').value = '';
    await loadClientes();
    document.getElementById('newObraCliente').value = data.id;
    document.getElementById('obraNewConstForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

// ========================= CARGAS POR PROYECTO =========================
async function toggleCargasProyecto(idProyecto) {
  var safeId = idProyecto.replace(/[^a-zA-Z0-9_-]/g, '_');
  // Try new table layout first
  var panel = document.getElementById('cargas-row-' + safeId);
  if (!panel) {
    // Fallback to old layout
    panel = document.getElementById('cargas-' + idProyecto);
  }
  if (!panel) return;
  
  if (panel.style.display === 'none') {
    panel.style.display = '';
    await loadCargasProyecto(idProyecto);
  } else {
    panel.style.display = 'none';
  }
}

async function loadCargasProyecto(idProyecto) {
  const list = document.getElementById('cargas-list-' + idProyecto);
  const data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/cargas?limit=500');
  if (!data || !data.cargas) { list.innerHTML = '<span class="muted">Error cargando</span>'; return; }
  if (data.cargas.length === 0) {
    list.innerHTML = '<span class="muted">Sin cargas registradas para este proyecto</span>';
    return;
  }
  var safeId = idProyecto.replace(/[^a-zA-Z0-9_-]/g, '_');
  list.innerHTML = `
    <div id="bulk-actions-${safeId}" style="display:none; margin-bottom:8px; padding:6px 10px; background:#fff3cd; border-radius:4px; font-size:12px;">
      <span id="bulk-count-${safeId}">0</span> carga(s) seleccionada(s)
      <button style="margin-left:10px; background:#dc3545; color:white; border:none; padding:3px 10px; border-radius:3px; font-size:11px; cursor:pointer;" onclick="eliminarCargasSeleccionadas('${idProyecto.replace(/'/g, "\\'")}')">🗑️ Eliminar seleccionadas</button>
      <button class="secondary" style="margin-left:6px; padding:2px 8px; font-size:10px;" onclick="deseleccionarCargasProyecto('${safeId}')">Deseleccionar</button>
    </div>
    <div style="max-height:350px; overflow-y:auto; border:1px solid #eee; border-radius:4px;">
    <table style="width:100%; font-size:12px;">
      <thead style="position:sticky; top:0; background:#f8f8f8; z-index:1;"><tr>
        <th style="width:28px;"><input type="checkbox" id="selectAll-${safeId}" onchange="toggleAllCargasProyecto('${safeId}')" style="cursor:pointer;" title="Seleccionar todas"></th>
        <th>Archivo</th><th>Plano</th><th>Barras</th><th>Kilos</th><th>Versión</th><th>Usuario</th><th>Fecha</th><th></th>
      </tr></thead>
      <tbody>${data.cargas.map(c => {
        let fecha = '';
        if (c.fecha) {
          const d = new Date(c.fecha);
          fecha = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
        }
        let estadoBadge = '';
        let rowBg = '';
        if (c.estado === 'parcial') {
          estadoBadge = '<span style="background:#fff3cd; color:#856404; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:600;" title="' + (c.errores || 'Algunas filas fueron rechazadas durante la importación').replace(/"/g, '&quot;') + '">&#9888; PARCIAL</span> ';
          rowBg = ' style="background:#fffde7;"';
        } else if (c.estado === 'error') {
          estadoBadge = '<span style="background:#ffcdd2; color:#b42318; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:600;" title="' + (c.errores || 'Todas las filas fueron rechazadas').replace(/"/g, '&quot;') + '">&#10060; ERROR</span> ';
          rowBg = ' style="background:#fff5f5;"';
        }
        return '<tr' + rowBg + '>' +
          '<td><input type="checkbox" class="carga-cb-' + safeId + '" data-id="' + c.id + '" onchange="updateCargasSelectionProyecto(\'' + safeId + '\')"></td>' +
          '<td>' + estadoBadge + (c.archivo || '-') + '</td>' +
          '<td>' + (c.plano_code || '-') + '</td>' +
          '<td>' + c.barras_count + '</td>' +
          '<td>' + Math.round(c.kilos || 0).toLocaleString() + ' kg</td>' +
          '<td>' + (c.version_archivo || '-') + '</td>' +
          '<td class="muted">' + c.usuario + '</td>' +
          '<td class="muted">' + fecha + '</td>' +
          '<td style="white-space:nowrap;">' +
            '<button class="secondary" style="padding:2px 6px; font-size:10px; margin-right:3px;" onclick="verBarrasCarga(' + c.id + ',\'' + idProyecto.replace(/'/g, "&#39;") + '\',\'' + (c.archivo || '').replace(/'/g, "&#39;") + '\')">Ver barras</button>' +
            '<button class="secondary" style="padding:2px 6px; font-size:10px; color:#b42318;" onclick="deleteCarga(' + c.id + ',\'' + idProyecto.replace(/'/g, "&#39;") + '\')">Eliminar</button>' +
          '</td>' +
        '</tr>';
      }).join('')}</tbody>
    </table>
    </div>
    <div class="muted" style="font-size:10px; margin-top:4px;">${data.cargas.length} carga(s) en total</div>`;
}

async function deleteCarga(cargaId, idProyecto) {
  if (!confirm('Eliminar esta carga? Se borrarán las barras importadas en esa fecha.')) return;
  const res = await apiDelete('/cargas/' + cargaId);
  if (res && res.ok) {
    alert('Carga eliminada: ' + res.barras_eliminadas + ' barras borradas');
    await loadCargasProyecto(idProyecto);
    await loadProyectos();
    await loadInicio();
    await loadMiActividad();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

// ========================= BULK DELETE CARGAS POR PROYECTO =========================
function toggleAllCargasProyecto(safeId) {
  var selectAll = document.getElementById('selectAll-' + safeId);
  var checkboxes = document.querySelectorAll('.carga-cb-' + safeId);
  checkboxes.forEach(function(cb) { cb.checked = selectAll.checked; });
  updateCargasSelectionProyecto(safeId);
}

function updateCargasSelectionProyecto(safeId) {
  var checkboxes = document.querySelectorAll('.carga-cb-' + safeId + ':checked');
  var count = checkboxes.length;
  var bulkActions = document.getElementById('bulk-actions-' + safeId);
  var countSpan = document.getElementById('bulk-count-' + safeId);
  var selectAll = document.getElementById('selectAll-' + safeId);
  var allCheckboxes = document.querySelectorAll('.carga-cb-' + safeId);
  
  if (bulkActions) bulkActions.style.display = count > 0 ? '' : 'none';
  if (countSpan) countSpan.textContent = count;
  
  if (selectAll && allCheckboxes.length > 0) {
    selectAll.checked = allCheckboxes.length === count;
    selectAll.indeterminate = count > 0 && count < allCheckboxes.length;
  }
}

function deseleccionarCargasProyecto(safeId) {
  document.querySelectorAll('.carga-cb-' + safeId).forEach(function(cb) { cb.checked = false; });
  var selectAll = document.getElementById('selectAll-' + safeId);
  if (selectAll) selectAll.checked = false;
  updateCargasSelectionProyecto(safeId);
}

async function eliminarCargasSeleccionadas(idProyecto) {
  var safeId = idProyecto.replace(/[^a-zA-Z0-9_-]/g, '_');
  var checkboxes = document.querySelectorAll('.carga-cb-' + safeId + ':checked');
  if (checkboxes.length === 0) return;
  
  var ids = Array.from(checkboxes).map(function(cb) { return parseInt(cb.dataset.id); });
  var count = ids.length;
  
  if (!confirm('¿Eliminar ' + count + ' carga(s) seleccionada(s)?\n\nEsta acción eliminará las barras asociadas y no se puede deshacer.')) {
    return;
  }
  
  var res = await apiPost('/cargas/bulk-delete', { ids: ids });
  if (res && res.ok) {
    var msg = 'Eliminadas ' + res.cargas_eliminadas + ' carga(s) con ' + res.barras_eliminadas + ' barras';
    if (res.skipped_cargas > 0) {
      msg += '\nOmitidas: ' + res.skipped_cargas + ' carga(s) (no encontradas o sin permiso)';
    }
    alert(msg);
    await loadCargasProyecto(idProyecto);
    await loadProyectos();
    await loadInicio();
    await loadMiActividad();
    await loadCargas();
  } else {
    alert('Error: ' + (res?.detail || res?.error || 'desconocido'));
  }
}

// ========================= AUTORIZADOS POR PROYECTO =========================
async function toggleAutorizados(idProyecto) {
  const panel = document.getElementById('autorizados-' + idProyecto);
  if (panel.style.display === 'none') {
    panel.style.display = '';
    await loadAutorizados(idProyecto);
    await loadUserSelect(idProyecto);
  } else {
    panel.style.display = 'none';
  }
}

async function loadAutorizados(idProyecto) {
  const list = document.getElementById('autorizados-list-' + idProyecto);
  const data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizados');
  if (!data || !data.autorizados) { list.innerHTML = '<span class="muted">Error cargando</span>'; return; }
  if (data.autorizados.length === 0) {
    list.innerHTML = '<span class="muted">Sin usuarios adicionales autorizados</span>';
    return;
  }
  var rolColors = {admin:'#1565C0',usc:'#FF9800',cubicador:'#8BC34A',externo:'#9C27B0',cliente:'#607D8B'};
  list.innerHTML = data.autorizados.map(a => {
    var nombre = [a.nombre, a.apellido].filter(Boolean).join(' ');
    var display = nombre ? nombre + ' (' + a.email + ')' : a.email;
    var rc = rolColors[a.rol] || '#666';
    return `<div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
      <span style="font-size:10px; padding:1px 6px; border-radius:3px; background:${rc}22; color:${rc}; font-weight:600;">${a.rol.toUpperCase()}</span>
      <span>${display}</span>
      <button class="secondary" style="font-size:10px; padding:1px 6px; color:#b42318; border-color:#b42318;" onclick="revocarUsuario('${idProyecto}', ${a.user_id})">&#10005;</button>
    </div>`;
  }).join('');
}

async function loadUserSelect(idProyecto) {
  const sel = document.getElementById('autorizar-user-' + idProyecto);
  const data = await apiGet('/users/list');
  if (!data || !data.users) { sel.innerHTML = '<option>Error</option>'; return; }
  sel.innerHTML = data.users.map(u => `<option value="${u.id}">${u.email}</option>`).join('');
}

async function autorizarUsuario(idProyecto) {
  const sel = document.getElementById('autorizar-user-' + idProyecto);
  const userId = parseInt(sel.value);
  if (!userId) return;
  var rolSel = document.getElementById('autorizar-rol-' + idProyecto);
  var rol = rolSel ? rolSel.value : 'cubicador';
  const res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, rol: rol })
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await loadAutorizados(idProyecto);
    await setGlobalStatus('Usuario autorizado', 'ok');
  } else {
    await setGlobalStatus(data.detail || 'Error autorizando', 'err');
  }
}

async function revocarUsuario(idProyecto, userId) {
  if (!confirm('Revocar acceso de este usuario?')) return;
  const res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar/' + userId, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await loadAutorizados(idProyecto);
    await setGlobalStatus('Acceso revocado', 'ok');
  } else {
    await setGlobalStatus(data.detail || 'Error revocando', 'err');
  }
}

async function openEditObraModal(idProyecto) {
  _editObraCurrentId = idProyecto;
  document.getElementById('editObraId').value = idProyecto;
  document.getElementById('editObraMsg').textContent = '';
  document.getElementById('editObraNewCalcForm').style.display = 'none';
  document.getElementById('editObraNewConstForm').style.display = 'none';
  document.getElementById('editObraNewCalcMsg').textContent = '';
  document.getElementById('editObraNewConstMsg').textContent = '';

  var data = await apiGet('/proyectos');
  var p = data && data.proyectos ? data.proyectos.find(function(x) { return x.id_proyecto === idProyecto; }) : null;

  document.getElementById('editObraNombre').value = p ? (p.nombre_proyecto || '') : '';
  document.getElementById('editObraDescripcion').value = p ? (p.descripcion || '') : '';

  var calcSel = document.getElementById('editObraCalculista');
  calcSel.innerHTML = '<option value="0">— Sin calculista —</option>' +
    _calculistasCache.map(function(c) {
      return '<option value="' + c.id + '"' + (p && c.id === p.calculista_id ? ' selected' : '') + '>' + c.nombre + '</option>';
    }).join('');
  if (p && p.calculista_id) calcSel.value = p.calculista_id;

  var constSel = document.getElementById('editObraConstructora');
  constSel.innerHTML = '<option value="0">— Sin constructora —</option>' +
    _clientesCache.map(function(c) {
      return '<option value="' + c.id + '"' + (p && c.id === p.constructora_id ? ' selected' : '') + '>' + c.nombre + '</option>';
    }).join('');
  if (p && p.constructora_id) constSel.value = p.constructora_id;

  document.getElementById('editObraAutorizadosList').textContent = 'Cargando...';
  var userSel = document.getElementById('editObraUserSel');
  userSel.innerHTML = '<option>Cargando...</option>';
  var usersData = await apiGet('/users/list');
  if (usersData && usersData.users) {
    userSel.innerHTML = usersData.users.map(function(u) {
      var label = [u.nombre, u.apellido].filter(Boolean).join(' ');
      return '<option value="' + u.id + '">' + (label ? label + ' (' + u.email + ')' : u.email) + '</option>';
    }).join('');
  }

  await loadAutorizadosEditObra(idProyecto);
  showModal('editObraModal');
}

function closeEditObraModal() {
  hideModal('editObraModal');
  _editObraCurrentId = null;
}

async function guardarEditObra() {
  var id = _editObraCurrentId;
  if (!id) return;
  var msg = document.getElementById('editObraMsg');
  var nombre = document.getElementById('editObraNombre').value.trim();
  if (!nombre) { msg.textContent = 'El nombre es obligatorio'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  var body = {
    nombre_proyecto: nombre,
    descripcion: document.getElementById('editObraDescripcion').value.trim(),
    calculista_id: parseInt(document.getElementById('editObraCalculista').value) || 0,
    constructora_id: parseInt(document.getElementById('editObraConstructora').value) || 0,
  };
  var res = await fetch('/proyectos/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Guardado'; msg.style.color = '#558B2F';
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    setTimeout(closeEditObraModal, 700);
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function loadAutorizadosEditObra(idProyecto) {
  var list = document.getElementById('editObraAutorizadosList');
  var data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizados');
  if (!data || !data.autorizados) { list.innerHTML = '<span class="muted">Error cargando</span>'; return; }
  if (data.autorizados.length === 0) { list.innerHTML = '<span class="muted">Sin usuarios autorizados</span>'; return; }
  var rolColors = {admin:'#1565C0', usc:'#FF9800', cubicador:'#8BC34A', externo:'#9C27B0', cliente:'#607D8B'};
  list.innerHTML = data.autorizados.map(function(a) {
    var nombre = [a.nombre, a.apellido].filter(Boolean).join(' ');
    var display = nombre ? nombre + ' (' + a.email + ')' : a.email;
    var rc = rolColors[a.rol] || '#666';
    return '<div style="display:flex; align-items:center; gap:6px; padding:2px 0;">' +
      '<span style="font-size:10px; padding:1px 5px; border-radius:3px; background:' + rc + '22; color:' + rc + '; font-weight:600;">' + a.rol.toUpperCase() + '</span>' +
      '<span style="font-size:12px;">' + display + '</span>' +
      '<button class="secondary" style="font-size:10px; padding:1px 5px; color:#b42318; border-color:#b42318; margin-left:4px;" onclick="revocarUsuarioEditObra(' + a.user_id + ')">&#10005;</button>' +
      '</div>';
  }).join('');
}

async function autorizarUsuarioEditObra() {
  var id = _editObraCurrentId;
  if (!id) return;
  var userId = parseInt(document.getElementById('editObraUserSel').value);
  var rol = document.getElementById('editObraUserRol').value;
  if (!userId) return;
  var res = await fetch('/proyectos/' + encodeURIComponent(id) + '/autorizar', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, rol: rol })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    await loadAutorizadosEditObra(id);
  } else {
    var msg = document.getElementById('editObraMsg');
    msg.textContent = data.detail || 'Error autorizando'; msg.style.color = '#b42318';
  }
}

async function revocarUsuarioEditObra(userId) {
  var id = _editObraCurrentId;
  if (!id || !confirm('\u00bfRevocar acceso de este usuario?')) return;
  var res = await fetch('/proyectos/' + encodeURIComponent(id) + '/autorizar/' + userId, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) await loadAutorizadosEditObra(id);
}

function toggleEditObraNewCalc() {
  var f = document.getElementById('editObraNewCalcForm');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearCalcDesdeEditObra() {
  var nombre = document.getElementById('editObraNewCalcNombre').value.trim();
  var msg = document.getElementById('editObraNewCalcMsg');
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
    document.getElementById('editObraNewCalcNombre').value = '';
    await loadCalculistas();
    var sel = document.getElementById('editObraCalculista');
    sel.innerHTML = '<option value="0">— Sin calculista —</option>' +
      _calculistasCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
    sel.value = data.id;
    document.getElementById('editObraNewCalcForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

function toggleEditObraNewConst() {
  var f = document.getElementById('editObraNewConstForm');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearConstDesdeEditObra() {
  var nombre = document.getElementById('editObraNewConstNombre').value.trim();
  var msg = document.getElementById('editObraNewConstMsg');
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
    document.getElementById('editObraNewConstNombre').value = '';
    await loadClientes();
    var sel = document.getElementById('editObraConstructora');
    sel.innerHTML = '<option value="0">— Sin constructora —</option>' +
      _clientesCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
    sel.value = data.id;
    document.getElementById('editObraNewConstForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function eliminarObra(id, nombre, barrasCount) {
  // Cubicador: solo puede eliminar obras vacías (sin barras)
  if (currentRole === 'cubicador' && barrasCount > 0) {
    alert('No puedes eliminar una obra con ' + barrasCount + ' barras cargadas. Contacta al administrador.');
    return;
  }
  const msg = barrasCount > 0
    ? 'Se eliminarán ' + barrasCount + ' barras asociadas a "' + nombre + '". Esta acción no se puede deshacer.'
    : 'Se eliminará la obra "' + nombre + '" (sin barras). Esta acción no se puede deshacer.';
  if (!confirm(msg)) return;
  const confirmText = prompt('Escribe ELIMINAR para confirmar:');
  if (confirmText !== 'ELIMINAR') { alert('Cancelado'); return; }
  const res = await fetch('/proyectos/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await setGlobalStatus('Obra eliminada: ' + nombre + ' (' + data.barras_eliminadas + ' barras)', 'ok');
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    await loadDashboard('sector');
    await loadSectores();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

async function moverBarras() {
  alert('Mover barras entre proyectos ya no está disponible.');
}

// ========================= FILTROS DEPENDIENTES + PERSISTENCIA =========================
const FILTER_STORAGE_KEY = 'armahub_filters';

function saveFiltersToStorage() {
  const state = {};
  ['proyecto','plano','sector','piso','ciclo','q','order_by','order_dir','filtroCarga'].forEach(f => {
    const el = document.getElementById(f);
    if (el) state[f] = el.value;
  });
  try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function restoreFiltersFromStorage() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    // Restore order fields first (they don't depend on data)
    ['order_by','order_dir','q'].forEach(f => {
      const el = document.getElementById(f);
      if (el && state[f] !== undefined) el.value = state[f];
    });
    // Return filter state for loadFilters to use after populating selects
    return state;
  } catch(e) { return null; }
}

async function loadFilters(depParams) {
  // Build query string for dependent filtering
  const qp = new URLSearchParams();
  if (depParams) {
    if (depParams.proyecto) qp.set('proyecto', depParams.proyecto);
    if (depParams.plano) qp.set('plano_code', depParams.plano);
    if (depParams.sector) qp.set('sector', depParams.sector);
    if (depParams.piso) qp.set('piso', depParams.piso);
  }
  const qs = qp.toString();
  const data = await apiGet('/filters' + (qs ? '?' + qs : ''));
  if (!data) return;
  
  function fillSelect(selId, items, mode = 'plain') {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const val = sel.value;
    const placeholder = sel.options[0] ? sel.options[0].textContent : 'Todos';
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = placeholder;
    sel.appendChild(opt0);
    (items || []).forEach(x => {
      const o = document.createElement('option');
      if (mode === 'planos') {
        o.value = x.code;
        o.textContent = x.nombre || x.code;
      } else if (mode === 'proyectos') {
        o.value = x.id;
        o.textContent = x.nombre || x.id;
      } else {
        o.value = x;
        o.textContent = x;
      }
      sel.appendChild(o);
    });
    // Restore previous value if still in options
    if (val && Array.from(sel.options).some(o => o.value === val)) {
      sel.value = val;
    }
  }
  
  // Proyectos always full list (show nombre, value=id)
  fillSelect('proyecto', data.proyectos, 'proyectos');
  fillSelect('exportProyecto', data.proyectos, 'proyectos');
  fillSelect('sectorProyectoFilter', data.proyectos, 'proyectos');
  fillSelect('matrizProyectoFilter', data.proyectos, 'proyectos');
  fillSelect('navProyectoFilter', data.proyectos, 'proyectos');
  fillSelect('pedidoProyecto', data.proyectos, 'proyectos');
  // Dependent selects
  fillSelect('plano', data.planos, 'planos');
  fillSelect('sector', data.sectores);
  fillSelect('piso', data.pisos);
  fillSelect('ciclo', data.ciclos);

}

function onProyectoChange() {
  // When project changes, reload dependent filters for that project
  const proy = document.getElementById('proyecto').value;
  // Clear dependent selects (their current values may not exist in new project)
  ['plano','sector','piso','ciclo'].forEach(f => { document.getElementById(f).value = ''; });
  clearCargaFilter(true);
  loadFilters(proy ? { proyecto: proy } : null);
  loadCargasDropdown(proy);
  saveFiltersToStorage();
  buscar(true);
}

async function loadCargasDropdown(idProyecto) {
  var sel = document.getElementById('filtroCarga');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas las cargas</option>';
  if (!idProyecto) return;
  var data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/cargas?limit=100');
  if (!data || !data.cargas || data.cargas.length === 0) return;
  data.cargas.forEach(function(c) {
    var label = (c.archivo || 'Carga #' + c.id) + ' (' + (c.barras_count || 0) + ' barras';
    if (c.kilos) label += ', ' + Math.round(c.kilos).toLocaleString('es-CL') + ' kg';
    label += ') - ' + (c.fecha ? c.fecha.substring(0, 10) : '?');
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function onCargaFilterChange() {
  var sel = document.getElementById('filtroCarga');
  var badge = document.getElementById('cargaFilterBadge');
  if (sel && sel.value && badge) {
    var txt = sel.options[sel.selectedIndex].textContent;
    document.getElementById('cargaFilterLabel').textContent = txt;
    badge.style.display = '';
  } else if (badge) {
    badge.style.display = 'none';
  }
  saveFiltersToStorage();
  buscar(true);
}

function onFilterChange() {
  // When any sub-filter changes, reload further dependent filters
  const proy = document.getElementById('proyecto').value;
  const plano = document.getElementById('plano').value;
  const sector = document.getElementById('sector').value;
  const piso = document.getElementById('piso').value;
  const dep = {};
  if (proy) dep.proyecto = proy;
  if (plano) dep.plano = plano;
  if (sector) dep.sector = sector;
  if (piso) dep.piso = piso;
  loadFilters(Object.keys(dep).length ? dep : null);
  saveFiltersToStorage();
  buscar(true);
}

// ========================= MULTI-FILE IMPORT =========================
let pendingFiles = [];

function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.style.background = '#f9fff4';
  e.currentTarget.style.borderColor = '#8BC34A';
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv') || f.name.endsWith('.txt'));
  if (files.length === 0) { alert('Solo se aceptan archivos CSV (.csv o .txt)'); return; }
  addFiles(files);
}

function handleFileSelect(fileList) {
  addFiles(Array.from(fileList));
}

function addFiles(files) {
  files.forEach(f => {
    if (!pendingFiles.find(p => p.name === f.name && p.size === f.size)) {
      pendingFiles.push(f);
    }
  });
  renderFileList();
}

function renderFileList() {
  const el = document.getElementById('fileList');
  const btn = document.getElementById('importBtn');
  const clearBtn = document.getElementById('clearBtn');
  if (pendingFiles.length === 0) {
    el.innerHTML = '';
    btn.disabled = true; btn.style.opacity = '0.5';
    clearBtn.style.display = 'none';
    return;
  }
  btn.disabled = false; btn.style.opacity = '1';
  clearBtn.style.display = '';
  el.innerHTML = pendingFiles.map((f, i) => `
    <div style="display:flex; align-items:center; gap:8px; padding:4px 8px; background:#f5f5f5; border-radius:4px; margin:4px 0; font-size:13px;">
      <span>📄 ${f.name}</span>
      <span class="muted">(${formatFileSizeKb(f.size, 1, '0 KB')})</span>
      <button class="secondary" style="padding:2px 8px; font-size:11px;" onclick="removeFile(${i})">✕</button>
    </div>
  `).join('');
}

function removeFile(idx) {
  pendingFiles.splice(idx, 1);
  renderFileList();
}

function clearFiles() {
  pendingFiles = [];
  document.getElementById('csvFile').value = '';
  document.getElementById('importResults').innerHTML = '';
  document.getElementById('importProgress').textContent = '';
  renderFileList();
}

async function importAllFiles() {
  if (pendingFiles.length === 0) return;
  const btn = document.getElementById('importBtn');
  const progress = document.getElementById('importProgress');
  const results = document.getElementById('importResults');
  btn.disabled = true; btn.style.opacity = '0.5';
  results.innerHTML = '';
  const total = pendingFiles.length;
  let successCount = 0;
  let errorCount = 0;
  let totalBarrasImported = 0;
  let totalKilosImported = 0;

  for (let i = 0; i < total; i++) {
    const f = pendingFiles[i];
    progress.textContent = `Importando ${i+1} de ${total}: ${f.name}...`;
    await setGlobalStatus(`Importando archivo ${i+1}/${total}...`, 'warn');

    const data = await apiPostFile('/import/armadetailer', f);

    if (!data) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: sesión expirada</div>`;
      errorCount++;
      continue;
    }
    if (data.ok === false && data.missing_project) {
      // CSV sin línea PROYECTO: — mostrar modal para elegir proyecto
      const missResult = await openMissingProjectModal(data);
      if (missResult.action === 'cancel') {
        results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: importación cancelada</div>`;
        errorCount++;
        continue;
      }
      let retryUrl;
      if (missResult.action === 'existing') {
        retryUrl = '/import/armadetailer?reasignar_a=' + encodeURIComponent(missResult.proyecto_id);
      } else {
        retryUrl = '/import/armadetailer?confirmar_nuevo=true&proyecto_nombre_manual=' + encodeURIComponent(missResult.nombre);
        if (missResult.calculista) retryUrl += '&calculista=' + encodeURIComponent(missResult.calculista);
        if (missResult.owner_id) retryUrl += '&owner_id=' + encodeURIComponent(missResult.owner_id);
        if (missResult.constructora_id) retryUrl += '&constructora_id=' + encodeURIComponent(missResult.constructora_id);
      }
      const data2 = await apiPostFile(retryUrl, f);
      if (data2 && data2.ok) {
        const kilosText2 = data2.kilos ? ` — ${Math.round(data2.kilos).toLocaleString()} kg` : '';
        totalBarrasImported += (data2.barras || 0);
        totalKilosImported += (data2.kilos || 0);
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.barras} barras (${data2.proyecto})${kilosText2} ${missResult.action === 'existing' ? '(reasignado)' : '(nuevo proyecto)'}</div>`;
        successCount++;
      } else {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data2?.error || data2?.mensaje || 'Error en importación'}</div>`;
        errorCount++;
      }
      continue;
    }
    if (data.ok === false && data.new_project) {
      // Proyecto nuevo detectado — mostrar popup para confirmar creación o asignar a obra existente
      const modalResult = await openNewProjectModal(data);
      if (!modalResult.confirmed) {
        results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: creación cancelada</div>`;
        errorCount++;
        continue;
      }
      let retryUrl;
      let resultLabel;
      if (modalResult.assign_to) {
        // Asignar código CSV a obra existente (crear alias)
        retryUrl = '/import/armadetailer?asignar_a=' + encodeURIComponent(modalResult.assign_to);
        resultLabel = '(asignado a obra existente)';
      } else {
        // Crear proyecto nuevo
        retryUrl = '/import/armadetailer?confirmar_nuevo=true';
        if (modalResult.nombre_override) retryUrl += '&proyecto_nombre_override=' + encodeURIComponent(modalResult.nombre_override);
        if (modalResult.calculista) retryUrl += '&calculista=' + encodeURIComponent(modalResult.calculista);
        if (modalResult.constructora_id) retryUrl += '&constructora_id=' + encodeURIComponent(modalResult.constructora_id);
        resultLabel = '(nuevo proyecto)';
      }
      const data2 = await apiPostFile(retryUrl, f);
      if (data2 && data2.ok) {
        const kilosText2 = data2.kilos ? ` — ${Math.round(data2.kilos).toLocaleString()} kg` : '';
        totalBarrasImported += (data2.barras || 0);
        totalKilosImported += (data2.kilos || 0);
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.barras} barras (${data2.proyecto})${kilosText2} ${resultLabel}</div>`;
        successCount++;
      } else {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data2?.error || data2?.mensaje || 'Error'}</div>`;
        errorCount++;
      }
      continue;
    }
    if (data.ok === false && data.duplicate_warning) {
      // Proyecto duplicado detectado — preguntar al usuario
      const choice = confirm(
        `⚠️ ${data.mensaje}\n\n` +
        `¿Deseas reasignar las barras al proyecto existente (ID: ${data.proyecto_existente_id})?\n\n` +
        `[Aceptar] = Reasignar al existente\n[Cancelar] = Crear proyecto nuevo con ID ${data.proyecto_nuevo_id}`
      );
      let retryUrl;
      if (choice) {
        retryUrl = '/import/armadetailer?reasignar_a=' + encodeURIComponent(data.proyecto_existente_id);
      } else {
        retryUrl = '/import/armadetailer?forzar=true';
      }
      const data2 = await apiPostFile(retryUrl, f);
      if (data2 && data2.ok) {
        const kilosText2 = data2.kilos ? ` — ${Math.round(data2.kilos).toLocaleString()} kg` : '';
        totalBarrasImported += (data2.barras || 0);
        totalKilosImported += (data2.kilos || 0);
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.barras} barras (${data2.proyecto})${kilosText2} ${choice ? '(reasignado)' : '(nuevo)'}</div>`;
        successCount++;
      } else {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data2?.error || 'Error en reimportación'}</div>`;
        errorCount++;
      }
      continue;
    }
    if (data.ok === false && data.duplicate_file) {
      const replace = confirm(`⚠️ ${data.mensaje}\n\n[Aceptar] = Reemplazar carga anterior\n[Cancelar] = Omitir este archivo`);
      if (!replace) {
        results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: omitido (carga previa conservada)</div>`;
        errorCount++;
        continue;
      }
      // Delete old carga first
      const delRes = await apiDelete('/cargas/' + data.carga_existente_id);
      if (!delRes || !delRes.ok) {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: no se pudo eliminar la carga anterior (${delRes?.detail || 'error'})</div>`;
        errorCount++;
        continue;
      }
      // Re-upload with forzar=true to skip duplicate checks
      const data2 = await apiPostFile('/import/armadetailer?forzar=true', f);
      if (data2 && data2.ok) {
        const kilosText2 = data2.kilos ? ` — ${Math.round(data2.kilos).toLocaleString()} kg` : '';
        totalBarrasImported += (data2.barras || 0);
        totalKilosImported += (data2.kilos || 0);
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.barras} barras (${data2.proyecto})${kilosText2} (reemplazado)</div>`;
        successCount++;
      } else {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data2?.error || data2?.mensaje || 'Error en reimportación'}</div>`;
        errorCount++;
      }
      continue;
    }
    if (data.ok === false && data.invalid_sectors) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">🚫 ${f.name}: ${data.mensaje}</div>`;
      errorCount++;
      continue;
    }
    if (data.ok === false && data.validation_failed) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">🚫 ${f.name}: ${data.mensaje}</div>`;
      errorCount++;
      continue;
    }
    if (data.ok === false) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data.error || data.mensaje || 'Error desconocido'}</div>`;
      errorCount++;
      continue;
    }

    const kilosText = data.kilos ? ` — ${Math.round(data.kilos).toLocaleString()} kg` : '';
    let validInfo = '';
    if (data.filas_rechazadas > 0) validInfo += ` ⚠️ ${data.filas_rechazadas} rechazadas`;
    if (data.advertencias > 0) validInfo += ` ℹ️ ${data.advertencias} advertencias`;
    const statusClass = data.estado === 'ok' ? 'status-ok' : 'status-warn';
    totalBarrasImported += (data.barras || 0);
    totalKilosImported += (data.kilos || 0);
    results.innerHTML += `<div class="${statusClass}" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data.barras} barras (${data.proyecto})${kilosText}${validInfo}</div>`;
    if (data.rejected && data.rejected.length > 0) {
      results.innerHTML += `<div class="muted" style="padding:2px 0 4px 20px; font-size:11px;">Rechazadas: ${data.rejected.slice(0,5).join(', ')}</div>`;
    }
    successCount++;
  }

  // Consolidated summary — always show
  try {
    var summaryParts = [`${successCount}/${total} planillas cargadas`];
    if (totalBarrasImported > 0) summaryParts.push(`${totalBarrasImported.toLocaleString()} barras`);
    if (totalKilosImported > 0) summaryParts.push(`${Math.round(totalKilosImported).toLocaleString()} kg`);
    if (errorCount > 0) summaryParts.push(`${errorCount} con error`);
    var summaryColor = successCount === total ? '#2e7d32' : (successCount > 0 ? '#e65100' : '#b42318');
    results.innerHTML += `<div style="margin-top:8px; padding:8px 12px; background:#f5f5f5; border-left:4px solid ${summaryColor}; border-radius:4px; font-size:13px; font-weight:600;">📊 Resumen: ${summaryParts.join(' — ')}</div>`;
    progress.textContent = '';
    await setGlobalStatus(`Importación completa: ${successCount}/${total} planillas`, successCount === total ? 'ok' : 'warn');
  } catch(e) { console.error('Error mostrando resumen:', e); }

  pendingFiles = [];
  document.getElementById('csvFile').value = '';
  btn.disabled = false; btn.style.opacity = '1';
  renderFileList();

  try {
    await loadCargas();
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    await loadMiActividad();
    await loadDashboard('sector');
  } catch(e) { console.error('Error refrescando datos post-import:', e); }
}

// ========================= CARGAS RECIENTES =========================
async function loadCargas() {
  const container = document.getElementById('cargasRecientes');
  if (!container) return;
  const data = await apiGet('/cargas/recientes?limit=5');
  if (!data) { container.innerHTML = '<div class="muted">Error cargando historial</div>'; return; }
  if (!data.cargas || data.cargas.length === 0) {
    container.innerHTML = '<div class="muted">No hay cargas registradas</div>';
    return;
  }
  // Compact card layout for right column
  container.innerHTML = data.cargas.map(c => {
    let fecha = '';
    if (c.fecha) {
      const d = new Date(c.fecha);
      fecha = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
    }
    let estadoBadge = '';
    let borderColor = '#e0e0e0';
    if (c.estado === 'parcial') {
      estadoBadge = '<span style="background:#fff3cd; color:#856404; padding:1px 4px; border-radius:2px; font-size:9px;">⚠</span> ';
      borderColor = '#ffc107';
    } else if (c.estado === 'error') {
      estadoBadge = '<span style="background:#ffcdd2; color:#b42318; padding:1px 4px; border-radius:2px; font-size:9px;">✗</span> ';
      borderColor = '#dc3545';
    }
    return `<div style="padding:6px 8px; border-left:3px solid ${borderColor}; margin-bottom:6px; background:#fafafa; border-radius:0 4px 4px 0;">
      <div style="font-weight:500; font-size:11px;">${estadoBadge}${c.nombre_proyecto || c.id_proyecto}</div>
      <div style="display:flex; justify-content:space-between; margin-top:2px;">
        <span class="muted" style="font-size:10px;">${c.barras_count} barras · ${Math.round(c.kilos || 0).toLocaleString()} kg</span>
        <span class="muted" style="font-size:10px;">${fecha}</span>
      </div>
    </div>`;
  }).join('');
}


// ========================= BAR MANAGER =========================
let currentOffset = 0;
const pageLimit = 100;
let lastTotal = 0;
let selectedBarras = new Set();

// Columnas compactas para la tabla
const DISPLAY_COLS = [
  { key: 'id_unico', label: 'ID', short: true },
  { key: 'sector',   label: 'Sector' },
  { key: 'piso',     label: 'Piso' },
  { key: 'ciclo',    label: 'Ciclo' },
  { key: 'eje',      label: 'Eje' },
  { key: 'diam',     label: 'φ', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'cant_total', label: 'Cant', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'largo_total', label: 'Largo', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'peso_unitario', label: 'Peso U.', fmt: v => v != null ? v.toFixed(2) : '' },
  { key: 'peso_total', label: 'Peso Total', fmt: v => v != null ? v.toFixed(1) : '' },
  { key: 'origen', label: 'Origen', fmt: v => {
    if (v === 'manual') return '<span style="background:#1565C0;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">manual</span>';
    if (v === 'pedido') return '<span style="background:#FF9800;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">pedido</span>';
    return '<span style="background:#9E9E9E;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">csv</span>';
  }},
];

function shortId(id) {
  if (!id) return '';
  const parts = id.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : id;
}

function updateToolbar() {
  const tb = document.getElementById('barrasToolbar');
  const cnt = document.getElementById('selectedCount');
  if (selectedBarras.size > 0) {
    tb.style.display = '';
    cnt.textContent = selectedBarras.size + ' seleccionada' + (selectedBarras.size > 1 ? 's' : '');
  } else {
    tb.style.display = 'none';
  }
}

function toggleBarra(id) {
  if (selectedBarras.has(id)) selectedBarras.delete(id);
  else selectedBarras.add(id);
  const cb = document.getElementById('cb_' + CSS.escape(id));
  if (cb) cb.checked = selectedBarras.has(id);
  const row = document.getElementById('row_' + CSS.escape(id));
  if (row) row.style.background = selectedBarras.has(id) ? '#f0f9e8' : '';
  updateToolbar();
}

function toggleAllBarras(checked) {
  document.querySelectorAll('.barra-cb').forEach(cb => {
    const id = cb.dataset.id;
    if (checked) selectedBarras.add(id); else selectedBarras.delete(id);
    cb.checked = checked;
    const row = document.getElementById('row_' + CSS.escape(id));
    if (row) row.style.background = checked ? '#f0f9e8' : '';
  });
  updateToolbar();
}

function clearSeleccion() {
  selectedBarras.clear();
  document.querySelectorAll('.barra-cb').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('tbody tr').forEach(tr => { tr.style.background = ''; });
  const sa = document.getElementById('selectAll');
  if (sa) sa.checked = false;
  updateToolbar();
}

async function accionMoverProyecto() {
  alert('Mover barras entre proyectos ya no está disponible. Usa "Duplicar" para crear una copia en otro proyecto.');
}

async function accionCambiarSector() {
  if (selectedBarras.size === 0) return alert('Selecciona al menos una barra');
  const sec = document.getElementById('accionSector').value;
  if (!sec) return alert('Selecciona sector destino');
  if (!confirm('Cambiar sector de ' + selectedBarras.size + ' barra(s) a ' + sec + '?')) return;
  const res = await apiPostJson('/barras/cambiar-sector', { id_unicos: Array.from(selectedBarras), nuevo_sector: sec });
  if (res && res.ok) {
    alert('Actualizadas: ' + res.modificadas + ' barras');
    clearSeleccion();
    buscar(true);
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

function toggleCrearBarraForm() {
  var card = document.getElementById('crearBarraCard');
  if (card.style.display === 'none') {
    card.style.display = '';
    // Populate project selector from the main project dropdown options
    var src = document.getElementById('proyecto');
    var dst = document.getElementById('crearBarraProy');
    if (src && dst) {
      dst.innerHTML = src.innerHTML;
      if (src.value) dst.value = src.value;
    }
  } else {
    card.style.display = 'none';
  }
}

async function crearBarraManual() {
  var msg = document.getElementById('crearBarraMsg');
  var proy = document.getElementById('crearBarraProy').value;
  var sector = document.getElementById('crearBarraSector').value;
  var piso = (document.getElementById('crearBarraPiso').value || '').trim().toUpperCase();
  var ciclo = (document.getElementById('crearBarraCiclo').value || '').trim().toUpperCase();
  var eje = (document.getElementById('crearBarraEje').value || '').trim();
  var diam = parseFloat(document.getElementById('crearBarraDiam').value);
  var largo = parseFloat(document.getElementById('crearBarraLargo').value);
  var cant = parseInt(document.getElementById('crearBarraCant').value) || 1;
  var figura = (document.getElementById('crearBarraFigura').value || '').trim() || null;
  var marca = (document.getElementById('crearBarraMarca').value || '').trim() || null;

  if (!proy || !sector || !piso || !ciclo || !eje || isNaN(diam) || isNaN(largo)) {
    msg.textContent = 'Completa los campos obligatorios (*)';
    msg.style.color = '#e53935';
    return;
  }
  msg.textContent = 'Creando...'; msg.style.color = '#666';

  var body = { id_proyecto: proy, sector: sector, piso: piso, ciclo: ciclo, eje: eje, diam: diam, largo_total: largo, cant: cant };
  if (figura) body.figura = figura;
  if (marca) body.marca = marca;

  var res = await apiPostJson('/barras/crear', body);
  if (res && res.ok) {
    msg.textContent = 'Barra creada: ' + res.id_unico + (res.peso_total ? ' (' + res.peso_total.toFixed(2) + ' kg)' : '');
    msg.style.color = '#4CAF50';
    ['crearBarraPiso','crearBarraCiclo','crearBarraEje','crearBarraDiam','crearBarraLargo','crearBarraFigura','crearBarraMarca'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('crearBarraCant').value = '1';
    buscar(true);
  } else {
    msg.textContent = 'Error: ' + (res?.detail || 'desconocido');
    msg.style.color = '#e53935';
  }
}

async function duplicarBarra(idUnico) {
  if (!confirm('¿Duplicar barra ' + idUnico + '?')) return;
  var res = await fetch('/barras/' + encodeURIComponent(idUnico) + '/duplicar', {
    method: 'POST', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    alert('Barra duplicada: ' + data.id_unico);
    buscar(false);
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

async function eliminarBarra(idUnico) {
  if (!confirm('¿Eliminar barra ' + idUnico + '? Esta acción no se puede deshacer.')) return;
  var res = await fetch('/barras/' + encodeURIComponent(idUnico), {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    selectedBarras.delete(idUnico);
    updateToolbar();
    buscar(false);
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

async function eliminarBarrasSeleccionadas() {
  if (selectedBarras.size === 0) return alert('Selecciona al menos una barra');
  var msg = (currentRole === 'admin' || currentRole === 'cubicador')
    ? '¿Eliminar ' + selectedBarras.size + ' barra(s)? Esta acción no se puede deshacer.'
    : '¿Eliminar ' + selectedBarras.size + ' barra(s)? Solo se eliminarán las manuales/pedido. Las CSV serán omitidas.';
  if (!confirm(msg)) return;
  var ids = Array.from(selectedBarras);
  var ok = 0, skip = 0, errors = [];
  for (var i = 0; i < ids.length; i++) {
    var res = await fetch('/barras/' + encodeURIComponent(ids[i]), {
      method: 'DELETE', headers: authHeaders()
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) { ok++; selectedBarras.delete(ids[i]); } else { skip++; if (data.detail) errors.push(data.detail); }
  }
  var resultMsg = 'Eliminadas: ' + ok;
  if (skip > 0) resultMsg += ' | No eliminadas: ' + skip;
  alert(resultMsg);
  updateToolbar();
  buscar(true);
}

async function buscar(reset = false) {
  if (reset) { currentOffset = 0; selectedBarras.clear(); updateToolbar(); }

  const proy = document.getElementById('proyecto').value;
  if (!proy) {
    document.getElementById('count').textContent = 'Selecciona un proyecto para ver sus barras.';
    document.getElementById('tabla').innerHTML = '';
    return;
  }

  const params = new URLSearchParams();
  params.set('proyecto', proy);
  ['plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    const v = document.getElementById(f).value;
    if (v) params.set(f === 'plano' ? 'plano_code' : f, v);
  });

  const q = document.getElementById('q').value.trim();
  if (q) params.set('q', q);

  const origenFilter = document.getElementById('filtroOrigen');
  if (origenFilter && origenFilter.value) params.set('origen', origenFilter.value);

  const cargaFilter = document.getElementById('filtroCarga');
  if (cargaFilter && cargaFilter.value) params.set('import_id', cargaFilter.value);

  params.set('limit', pageLimit);
  params.set('offset', currentOffset);
  const orderBy = document.getElementById('order_by').value || 'sector';
  const orderDir = document.getElementById('order_dir').value || 'asc';
  params.set('order_by', orderBy);
  params.set('order_dir', orderDir);

  saveFiltersToStorage();
  const data = await apiGet('/barras?' + params.toString());
  if (!data) return;

  lastTotal = data.total || 0;
  const page = Math.floor(currentOffset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(lastTotal / pageLimit));

  var cargaActive = document.getElementById('filtroCarga') && document.getElementById('filtroCarga').value;
  document.getElementById('count').textContent = lastTotal.toLocaleString() + ' barras' + (cargaActive ? ' en esta carga' : ' en proyecto');
  document.getElementById('pageInfo').textContent = 'Pág ' + page + '/' + totalPages;

  const table = document.getElementById('tabla');
  table.innerHTML = '';

  if (!data.data || !data.data.length) {
    table.innerHTML = '<tr><td colspan="12" class="muted" style="padding:20px; text-align:center;">Sin resultados</td></tr>';
    return;
  }

  // Header
  let hdr = '<thead><tr style="font-size:11px;"><th style="width:28px;"><input type="checkbox" id="selectAll" onchange="toggleAllBarras(this.checked)" /></th>';
  DISPLAY_COLS.forEach(c => {
    const ord = document.getElementById('order_by').value;
    const dir = document.getElementById('order_dir').value;
    const arrow = c.key === ord ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
    hdr += '<th style="cursor:pointer; padding:4px 6px;" onclick="document.getElementById(\'order_by\').value=\'' + c.key + '\'; buscar(true);">' + c.label + arrow + '</th>';
  });
  hdr += '<th style="padding:4px 6px;">Acciones</th>';
  hdr += '</tr></thead>';

  // Body
  let body = '<tbody>';
  data.data.forEach(row => {
    const id = row.id_unico;
    const sel = selectedBarras.has(id);
    const safeId = id.replace(/"/g, '&quot;').replace(/'/g, "\\'");
    body += '<tr id="row_' + id.replace(/"/g, '') + '" style="' + (sel ? 'background:#f0f9e8;' : '') + '">';
    body += '<td style="width:28px;"><input type="checkbox" class="barra-cb" data-id="' + id + '" id="cb_' + id.replace(/"/g, '') + '" ' + (sel ? 'checked' : '') + ' onchange="toggleBarra(\'' + id.replace(/'/g, "\\'") + '\')" /></td>';
    DISPLAY_COLS.forEach(c => {
      let val = row[c.key];
      if (c.short) val = shortId(val);
      if (c.fmt) val = c.fmt(row[c.key]);
      body += '<td style="padding:3px 6px;">' + (val != null && val !== '' ? val : '') + '</td>';
    });
    var canDelete = (currentRole === 'admin' || currentRole === 'cubicador') || (row.origen === 'manual' || row.origen === 'pedido' || !row.origen);
    body += '<td style="padding:3px 4px; white-space:nowrap;">';
    body += '<button class="secondary" style="font-size:10px; padding:1px 6px; margin-right:3px;" onclick="duplicarBarra(\'' + safeId + '\')">Duplicar</button>';
    if (canDelete) body += '<button class="secondary" style="font-size:10px; padding:1px 6px; color:#b42318;" onclick="eliminarBarra(\'' + safeId + '\')">✕</button>';
    body += '</td>';
    body += '</tr>';
  });
  body += '</tbody>';

  table.innerHTML = hdr + body;
}

function resetFiltros() {
  ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    document.getElementById(f).value = '';
  });
  document.getElementById('q').value = '';
  var fo = document.getElementById('filtroOrigen');
  if (fo) fo.value = '';
  clearCargaFilter(true);
  loadCargasDropdown('');
  const si = document.getElementById('proyectoSearchInput');
  if (si) si.value = '';
  try { localStorage.removeItem(FILTER_STORAGE_KEY); } catch(e) {}
  selectedBarras.clear();
  updateToolbar();
  loadFilters();
  buscar(true);
}

async function verBarrasCarga(importId, idProyecto, archivo) {
  // Switch to Bar Manager tab
  switchTab('buscar');

  // Set project filter
  var proySel = document.getElementById('proyecto');
  if (proySel) proySel.value = idProyecto;

  // Load cargas dropdown so the option exists, then select it
  await loadCargasDropdown(idProyecto);
  var fc = document.getElementById('filtroCarga');
  if (fc) fc.value = importId;
  document.getElementById('cargaFilterBadge').style.display = '';
  document.getElementById('cargaFilterLabel').textContent = archivo || ('Carga #' + importId);

  buscar(true);
}

function clearCargaFilter(skipSearch) {
  var fc = document.getElementById('filtroCarga');
  if (fc) fc.value = '';
  var badge = document.getElementById('cargaFilterBadge');
  if (badge) badge.style.display = 'none';
  if (!skipSearch) buscar(true);
}

function prevPage() {
  currentOffset = Math.max(0, currentOffset - pageLimit);
  buscar(false);
}

function nextPage() {
  if (currentOffset + pageLimit >= lastTotal) return;
  currentOffset += pageLimit;
  buscar(false);
}

// ========================= EXPORTACIÓN =========================
// State for export matrix
let _exportSelected = new Set();   // keys like "ELEV_P1_C1"
let _exportAllKeys = [];           // all available keys for current project
let _exportProy = '';              // current project in export tab
let _exportHistory = {};           // server-side history: { key: {veces, ultima_fecha, ...} }
let _exportItems = [];             // cached items for current project

async function previewExport() {
  const proy = document.getElementById('exportProyecto').value;
  const preview = document.getElementById('exportPreview');
  const matrizCard = document.getElementById('exportMatrizCard');
  const reportCard = document.getElementById('exportReportCard');
  _exportProy = proy;
  _exportSelected = new Set();
  _exportAllKeys = [];
  _exportHistory = {};
  _exportItems = [];

  if (!proy) {
    preview.innerHTML = '';
    matrizCard.style.display = 'none';
    if (reportCard) reportCard.style.display = 'none';
    return;
  }

  preview.innerHTML = '<div class="muted">Cargando...</div>';

  const [data, histData] = await Promise.all([
    apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(proy)),
    apiGet('/proyectos/' + encodeURIComponent(proy) + '/export-history'),
  ]);

  if (!data || !data.items || data.items.length === 0) {
    preview.innerHTML = '<span class="muted">Este proyecto no tiene barras para exportar.</span>';
    matrizCard.style.display = 'none';
    if (reportCard) reportCard.style.display = 'none';
    return;
  }

  _exportHistory = (histData && histData.history) ? histData.history : {};
  _exportItems = data.items;

  // Summary
  let totalBarras = 0, totalKilos = 0;
  data.items.forEach(i => { totalBarras += i.barras || 0; totalKilos += i.kilos || 0; });
  const doneCount = Object.keys(_exportHistory).length;
  preview.innerHTML = '<div style="background:#f8f9fa; padding:12px; border-radius:6px; font-size:13px;">' +
    '<strong>' + totalBarras.toLocaleString() + ' barras</strong> · <strong>' + Math.round(totalKilos).toLocaleString() + ' kg</strong> disponibles para exportar.' +
    (doneCount > 0 ? ' · <span style="color:#558B2F;">' + doneCount + ' sectores ya exportados</span>' : '') +
    '<span class="muted" style="margin-left:8px; font-size:11px;">Un .xlsx por cada combinación SECTOR + PISO + CICLO.</span>' +
    '</div>';

  matrizCard.style.display = 'block';
  buildExportMatriz(data.items, proy);
  buildExportReport(proy);
}

function buildExportMatriz(items, proy) {
  const container = document.getElementById('exportMatrizContainer');

  // Build lookup: key = "SECTOR|PISO|CICLO" => {barras, kilos}
  const lookup = {};
  items.forEach(i => {
    const s = (i.sector || '?').toUpperCase().trim();
    const p = (i.piso || '?').trim();
    const c = (i.ciclo || '?').trim();
    lookup[s + '|' + p + '|' + c] = { barras: i.barras, kilos: i.kilos };
  });

  // Collect unique pisos and ciclos
  const pisosSet = new Set(), ciclosSet = new Set(), sectoresSet = new Set();
  items.forEach(i => {
    pisosSet.add((i.piso || '?').trim());
    ciclosSet.add((i.ciclo || '?').trim());
    sectoresSet.add((i.sector || '?').toUpperCase().trim());
  });

  const pisos = Array.from(pisosSet).sort((a, b) => pisoOrder(a) - pisoOrder(b));
  pisos.reverse(); // highest floor at top

  const ciclos = Array.from(ciclosSet).sort((a, b) => {
    const na = parseInt((a.match(/(\d+)/) || [0,0])[1]);
    const nb = parseInt((b.match(/(\d+)/) || [0,0])[1]);
    return na - nb;
  });

  const TYPE_ORDER = ['FUND', 'LCIELO', 'VCIELO', 'ELEV'];
  const lowestPiso = pisos[pisos.length - 1];

  function getTypesForPiso(piso) {
    const types = [];
    if (piso === lowestPiso) {
      for (const c of ciclos) { if (lookup['FUND|' + piso + '|' + c]) { types.push('FUND'); break; } }
    }
    for (const t of TYPE_ORDER) {
      if (t === 'FUND') continue;
      for (const c of ciclos) { if (lookup[t + '|' + piso + '|' + c]) { types.push(t); break; } }
    }
    for (const s of sectoresSet) {
      if (TYPE_ORDER.includes(s)) continue;
      for (const c of ciclos) { if (lookup[s + '|' + piso + '|' + c]) { types.push(s); break; } }
    }
    return types.length > 0 ? types : ['ELEV'];
  }

  // Collect all exportable keys
  _exportAllKeys = [];
  pisos.forEach(piso => {
    const types = getTypesForPiso(piso);
    types.forEach(tipo => {
      ciclos.forEach(ciclo => {
        if (lookup[tipo + '|' + piso + '|' + ciclo]) {
          _exportAllKeys.push(tipo + '_' + piso + '_' + ciclo);
        }
      });
    });
  });

  // Section type initials for piso breakdown
  const TYPE_INITIALS = { 'FUND': 'F', 'LCIELO': 'L', 'VCIELO': 'V', 'ELEV': 'E' };

  // Build HTML table
  let html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  // Header row with ciclo names (clickable for column selection)
  html += '<thead><tr>';
  html += '<th style="border:1px solid #333; padding:3px 4px; background:#1a1a1a; color:#8BC34A; white-space:nowrap; min-width:120px; font-size:10px;">Piso</th>';
  ciclos.forEach(c => {
    html += '<th style="border:1px solid #333; padding:2px 4px; background:#1a1a1a; color:#8BC34A; text-align:center; white-space:nowrap; cursor:pointer; font-size:10px;" onclick="exportToggleCiclo(\'' + c + '\')" title="Seleccionar/deseleccionar columna ' + c + '">' + c + '</th>';
  });
  html += '</tr></thead><tbody>';

  pisos.forEach(piso => {
    const types = getTypesForPiso(piso);
    // Compute piso-level totals (kg and barras) and per-section totals
    const pisoKeys = [];
    let pisoTotalKg = 0, pisoTotalBar = 0;
    const sectionTotals = {}; // { 'ELEV': {kg, bar}, 'LCIELO': {kg, bar}, ... }
    types.forEach(tipo => {
      if (!sectionTotals[tipo]) sectionTotals[tipo] = { kg: 0, bar: 0 };
      ciclos.forEach(ciclo => {
        const d = lookup[tipo + '|' + piso + '|' + ciclo];
        if (d) {
          pisoKeys.push(tipo + '_' + piso + '_' + ciclo);
          pisoTotalKg += d.kilos;
          pisoTotalBar += d.barras;
          sectionTotals[tipo].kg += d.kilos;
          sectionTotals[tipo].bar += d.barras;
        }
      });
    });
    const allPisoSelected = pisoKeys.length > 0 && pisoKeys.every(k => _exportSelected.has(k));
    const somePisoSelected = pisoKeys.some(k => _exportSelected.has(k));

    types.forEach((tipo, typeIdx) => {
      html += '<tr>';
      if (typeIdx === 0) {
        // Piso cell with checkbox + total + section breakdown
        html += '<td rowspan="' + types.length + '" style="border:1px solid #ccc; padding:4px 5px; font-weight:bold; background:#f8f8f8; color:#1a1a1a; vertical-align:middle; white-space:nowrap; min-width:120px;">';
        // Top: checkbox + piso name + total
        html += '<div style="display:flex; align-items:center; gap:4px; cursor:pointer; margin-bottom:3px;" onclick="exportTogglePiso(\'' + piso + '\')" title="Seleccionar/deseleccionar todo ' + piso + '">';
        const cbStyle = allPisoSelected ? 'checked' : '';
        const indeterminate = (!allPisoSelected && somePisoSelected) ? 'style="opacity:0.5;"' : '';
        html += '<input type="checkbox" ' + cbStyle + ' ' + indeterminate + ' style="width:13px; height:13px; pointer-events:none; accent-color:#4285f4; margin:0; flex-shrink:0;" />';
        html += '<span style="font-size:11px; font-weight:700; line-height:1;">' + piso + ': ' + Math.round(pisoTotalKg).toLocaleString() + 'kg ' + pisoTotalBar + 'un</span>';
        html += '</div>';
        // Bottom: section breakdown lines
        if (types.length > 1 || types[0] !== 'ELEV') {
          html += '<div style="padding-left:18px; font-size:9px; color:#555; line-height:1.4;">';
          types.forEach(t => {
            const st = sectionTotals[t];
            const initial = TYPE_INITIALS[t] || t.charAt(0);
            html += '<div>' + initial + ': ' + Math.round(st.kg).toLocaleString() + 'kg ' + st.bar + 'un</div>';
          });
          html += '</div>';
        }
        html += '</td>';
      }
      // Data cells for each ciclo
      ciclos.forEach(ciclo => {
        const lookupKey = tipo + '|' + piso + '|' + ciclo;
        const exportKey = tipo + '_' + piso + '_' + ciclo;
        const d = lookup[lookupKey];
        if (d) {
          const hist = _exportHistory[exportKey];
          const isDone = !!hist;
          const isSelected = _exportSelected.has(exportKey);
          // Check if sector was modified after last export
          let isModified = false;
          if (isDone && hist.ultima_modificacion && hist.ultima_fecha) {
            isModified = hist.ultima_modificacion > hist.ultima_fecha;
          }
          // Background: rosado if modified, green if exported and not modified, blue if selected, white otherwise
          let bg = '#fff';
          if (isSelected) {
            bg = '#e3f0ff';
          } else if (isDone && isModified) {
            bg = '#ffcdd2'; // rosado - modified after export
          } else if (isDone) {
            bg = '#e8f5e9'; // green - exported and unchanged
          }
          const border = isSelected ? '2px solid #4285f4' : '1px solid #ccc';
          let doneTitle = '';
          if (isDone) {
            doneTitle = ' | Exportado ' + hist.veces + 'x, \u00faltimo: ' + (hist.ultima_fecha || '').substring(0, 10);
            if (isModified) doneTitle += ' | ⚠️ MODIFICADO - requiere re-exportar';
          }
          html += '<td style="border:' + border + '; padding:2px 4px; background:' + bg + '; text-align:center; cursor:pointer; position:relative; transition:all 0.12s; min-width:80px; white-space:nowrap;" ';
          html += 'onclick="exportToggleCell(\'' + exportKey + '\')" ';
          html += 'title="' + tipo + ' ' + piso + ' ' + ciclo + ': ' + d.barras + ' barras, ' + Math.round(d.kilos).toLocaleString() + ' kg' + doneTitle + '">';
          // Checkbox
          html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' style="position:absolute; top:1px; left:1px; width:11px; height:11px; pointer-events:none; accent-color:#4285f4;" />';
          // Done badge - warning icon if modified, checkmark if not
          if (isDone) {
            if (isModified) {
              html += '<span style="position:absolute; top:0px; right:2px; font-size:9px; color:#c62828;" title="Modificado después de exportar - requiere re-exportar">&#9888;</span>';
            } else {
              html += '<span style="position:absolute; top:0px; right:2px; font-size:9px; color:#558B2F;" title="Exportado ' + hist.veces + ' vez(es)">&#10004;</span>';
            }
          }
          // Compact single-line: TIPO  kg  un
          html += '<div style="display:flex; align-items:baseline; justify-content:center; gap:4px;">';
          html += '<span style="font-weight:600; font-size:9px; color:#666;">' + tipo + '</span>';
          html += '<span style="font-size:10px; font-weight:bold; color:#1a1a1a;">' + Math.round(d.kilos).toLocaleString() + 'kg</span>';
          html += '<span style="font-size:9px; color:#888;">' + d.barras + 'un</span>';
          html += '</div>';
          html += '</td>';
        } else {
          html += '<td style="border:1px solid #eee; padding:2px; background:#fafafa;"></td>';
        }
      });
      html += '</tr>';
    });
  });

  html += '</tbody></table>';

  // Legend
  html += '<div style="margin-top:6px; display:flex; gap:10px; align-items:center; font-size:10px; flex-wrap:wrap;">';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#e3f0ff; border:2px solid #4285f4; vertical-align:middle;"></span> Seleccionado</span>';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#e8f5e9; border:1px solid #8BC34A; vertical-align:middle;"></span> <span style="color:#558B2F;">&#10004;</span> Ya exportado</span>';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#ffcdd2; border:1px solid #e57373; vertical-align:middle;"></span> <span style="color:#c62828;">&#9888;</span> Modificado (re-exportar)</span>';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#fff; border:1px solid #ccc; vertical-align:middle;"></span> Pendiente</span>';
  html += '</div>';

  container.innerHTML = html;
  updateExportSelCount();
}

async function buildExportReport(proy) {
  const reportCard = document.getElementById('exportReportCard');
  if (!reportCard) return;
  const reportContainer = document.getElementById('exportReportContainer');
  if (!reportContainer) return;

  const rpt = await apiGet('/proyectos/' + encodeURIComponent(proy) + '/export-report');
  if (!rpt) { reportCard.style.display = 'none'; return; }

  reportCard.style.display = 'block';
  let html = '<div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;">';
  html += '<div style="background:#f8f9fa; padding:8px 14px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:20px; font-weight:bold; color:#1a1a1a;">' + rpt.total_sectores + '</div>';
  html += '<div style="font-size:10px; color:#888;">Total sectores</div></div>';
  html += '<div style="background:#e8f5e9; padding:8px 14px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:20px; font-weight:bold; color:#558B2F;">' + rpt.exportados + '</div>';
  html += '<div style="font-size:10px; color:#888;">Exportados</div></div>';
  html += '<div style="background:#fff3e0; padding:8px 14px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:20px; font-weight:bold; color:#e65100;">' + rpt.pendientes + '</div>';
  html += '<div style="font-size:10px; color:#888;">Pendientes</div></div>';
  html += '<div style="background:#f8f9fa; padding:8px 14px; border-radius:6px; text-align:center;">';
  // Progress bar
  html += '<div style="font-size:16px; font-weight:bold; color:#1a1a1a;">' + rpt.porcentaje + '%</div>';
  html += '<div style="width:80px; height:6px; background:#e0e0e0; border-radius:3px; margin-top:2px;">';
  html += '<div style="width:' + rpt.porcentaje + '%; height:100%; background:#8BC34A; border-radius:3px;"></div></div>';
  html += '<div style="font-size:10px; color:#888;">Progreso</div></div>';
  html += '</div>';

  // Detail table
  if (rpt.items && rpt.items.length > 0) {
    html += '<details><summary style="cursor:pointer; font-size:11px; color:#666; margin-bottom:4px;">Ver detalle por sector</summary>';
    html += '<table style="width:100%; border-collapse:collapse; font-size:10px; margin-top:4px;">';
    html += '<thead><tr style="background:#f5f5f5;">';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Sector</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Piso</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Ciclo</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:right;">Barras</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:right;">Kilos</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:center;">Estado</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:center;">Veces</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Ultima exp.</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Usuario</th>';
    html += '</tr></thead><tbody>';
    rpt.items.forEach(it => {
      const rowBg = it.exportado ? '#f6fdf6' : '#fff';
      html += '<tr style="background:' + rowBg + ';">';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.sector || '') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.piso || '') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.ciclo || '') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px; text-align:right;">' + it.barras + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px; text-align:right;">' + it.kilos.toLocaleString() + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px; text-align:center;">' + (it.exportado ? '<span style="color:#558B2F; font-weight:bold;">Exportado</span>' : '<span style="color:#999;">Pendiente</span>') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px; text-align:center;">' + (it.veces_exportado || 0) + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.ultima_fecha ? it.ultima_fecha.substring(0, 16).replace('T', ' ') : '-') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.ultimo_usuario || '-') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></details>';
  }

  reportContainer.innerHTML = html;
}

function exportToggleCell(key) {
  if (_exportSelected.has(key)) {
    _exportSelected.delete(key);
  } else {
    _exportSelected.add(key);
  }
  // Re-render matrix without re-fetching
  if (_exportItems.length > 0) {
    buildExportMatriz(_exportItems, _exportProy);
  }
}

function exportTogglePiso(piso) {
  const pisoKeys = _exportAllKeys.filter(k => {
    const parts = k.split('_');
    return parts.length >= 3 && parts[1] === piso;
  });
  const allSelected = pisoKeys.every(k => _exportSelected.has(k));
  pisoKeys.forEach(k => { allSelected ? _exportSelected.delete(k) : _exportSelected.add(k); });
  if (_exportItems.length > 0) buildExportMatriz(_exportItems, _exportProy);
}

function exportToggleCiclo(ciclo) {
  const cicloKeys = _exportAllKeys.filter(k => {
    const parts = k.split('_');
    return parts.length >= 3 && parts[parts.length - 1] === ciclo;
  });
  const allSelected = cicloKeys.every(k => _exportSelected.has(k));
  cicloKeys.forEach(k => { allSelected ? _exportSelected.delete(k) : _exportSelected.add(k); });
  if (_exportItems.length > 0) buildExportMatriz(_exportItems, _exportProy);
}

function exportSelectAll(select) {
  if (select) {
    _exportAllKeys.forEach(k => _exportSelected.add(k));
  } else {
    _exportSelected.clear();
  }
  if (_exportItems.length > 0) buildExportMatriz(_exportItems, _exportProy);
}

async function reRenderExportMatriz() {
  if (!_exportProy) return;
  const [data, histData] = await Promise.all([
    apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(_exportProy)),
    apiGet('/proyectos/' + encodeURIComponent(_exportProy) + '/export-history'),
  ]);
  _exportHistory = (histData && histData.history) ? histData.history : {};
  if (data && data.items) {
    _exportItems = data.items;
    buildExportMatriz(data.items, _exportProy);
  }
  buildExportReport(_exportProy);
}

function updateExportSelCount() {
  const n = _exportSelected.size;
  const total = _exportAllKeys.length;
  const countEl = document.getElementById('exportSelCount');
  const btn = document.getElementById('exportSelBtn');
  if (countEl) countEl.textContent = n + ' de ' + total + ' seleccionados';
  if (btn) {
    btn.textContent = 'Exportar seleccionados (' + n + ')';
    btn.disabled = (n === 0);
    btn.style.opacity = n === 0 ? '0.5' : '1';
  }
}

async function descargarExportSeleccionados() {
  const proy = _exportProy;
  if (!proy) return alert('Selecciona un proyecto');
  if (_exportSelected.size === 0) return alert('Selecciona al menos un sector');

  const sectoresParam = Array.from(_exportSelected).join(',');
  const status = document.getElementById('exportStatus');
  status.textContent = 'Generando ' + _exportSelected.size + ' archivos Excel...';

  try {
    const url = '/proyectos/' + encodeURIComponent(proy) + '/exportar?sectores=' + encodeURIComponent(sectoresParam);
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const err = await res.json();
      status.textContent = 'Error: ' + (err.detail || 'desconocido');
      return;
    }
    const blob = await res.blob();
    _triggerDownload(blob, res);

    status.textContent = 'Descarga completada — ' + _exportSelected.size + ' sectores exportados.';
    // Refresh history from server
    await reRenderExportMatriz();
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
}

async function descargarExport() {
  const proy = document.getElementById('exportProyecto').value || _exportProy;
  if (!proy) return alert('Selecciona un proyecto');
  const status = document.getElementById('exportStatus');
  status.textContent = 'Generando todos los archivos Excel...';

  try {
    const res = await fetch('/proyectos/' + encodeURIComponent(proy) + '/exportar', { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const err = await res.json();
      status.textContent = 'Error: ' + (err.detail || 'desconocido');
      return;
    }
    const blob = await res.blob();
    _triggerDownload(blob, res);

    status.textContent = 'Descarga completada — todos los sectores exportados.';
    // Refresh history from server
    await reRenderExportMatriz();
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
}

function _triggerDownload(blob, res) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const cd = res.headers.get('Content-Disposition');
  const fn = cd ? cd.split('filename=')[1].replace(/"/g, '') : 'export.zip';
  a.download = fn;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ========================= DASHBOARD =========================
let chart = null;

function renderChart(labels, values, title) {
  chart = replaceChart(chart, document.getElementById('dashChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: title, data: values, backgroundColor: '#8BC34A' }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' }
  });
}

// Reusable piso ordering function (building order: SM top, subterráneos bottom)
function pisoOrder(p) {
  const up = (p || '').toUpperCase().trim();
  if (up === 'SM' || up === 'SALA DE MAQUINAS') return 9999;
  const m = up.match(/^S(\d+)/);
  if (m) return -parseInt(m[1]);
  const m2 = up.match(/^P(\d+)/);
  if (m2) return parseInt(m2[1]);
  const m3 = up.match(/(\d+)/);
  if (m3) return parseInt(m3[1]);
  return 0;
}

async function loadDashboard(groupBy) {
  await setGlobalStatus("Cargando gráfico...", "warn");
  const data = await apiGet('/dashboard?group_by=' + encodeURIComponent(groupBy));
  if (!data) return;
  
  document.getElementById('dashTotals').textContent = `Total: ${data.total.barras} barras — ${data.total.kilos.toFixed(2)} kg`;
  
  // Sort by building order when grouping by piso
  let items = data.items;
  if (groupBy === 'piso') {
    items = [...items].sort((a, b) => pisoOrder(b.grupo) - pisoOrder(a.grupo));
  }

  const labels = items.map(x => (x.grupo === null || x.grupo === '' || x.grupo === undefined) ? '(sin valor)' : x.grupo);
  const values = items.map(x => Number(x.kilos || 0));
  
  renderChart(labels, values, `Kilos por ${groupBy}`);
  await setGlobalStatus("Gráfico actualizado", "ok");
}

// ========================= SECTORES CONSTRUCTIVOS =========================
let sectoresChart = null;

async function loadSectores() {
  const sel = document.getElementById('sectorProyectoFilter');
  const proy = sel.value;
  let url = '/dashboard/sectores';
  if (proy) url += '?proyecto=' + encodeURIComponent(proy);

  const data = await apiGet(url);
  if (!data) return;

  const tbody = document.getElementById('sectoresBody');
  const totals = document.getElementById('sectoresTotals');

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Sin datos de sectores</td></tr>';
    totals.textContent = '';
    sectoresChart = destroyChart(sectoresChart);
    return;
  }

  // Sort by building order (piso)
  data.items.sort((a, b) => pisoOrder(a.piso) - pisoOrder(b.piso));

  const totalBarras = data.items.reduce((s, i) => s + i.barras, 0);
  const totalKilos = data.items.reduce((s, i) => s + i.kilos, 0);
  totals.textContent = `${data.items.length} sectores — ${totalBarras.toLocaleString()} barras — ${Math.round(totalKilos).toLocaleString()} kg`;

  tbody.innerHTML = data.items.map(i => `
    <tr>
      <td><strong>${i.sector_constructivo}</strong></td>
      <td style="text-align:right;">${i.barras.toLocaleString()}</td>
      <td style="text-align:right;">${Math.round(i.kilos).toLocaleString()} kg</td>
    </tr>
  `).join('');

  // Chart
  const labels = data.items.map(i => i.sector_constructivo);
  const kilosData = data.items.map(i => i.kilos);
  const barrasData = data.items.map(i => i.barras);
  sectoresChart = replaceChart(sectoresChart, document.getElementById('sectoresChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Kilos', data: kilosData, backgroundColor: '#8BC34A', borderRadius: 3, yAxisID: 'y' },
        { label: 'Barras', data: barrasData, backgroundColor: '#42A5F5', borderRadius: 3, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { type: 'linear', position: 'left', title: { display: true, text: 'Kilos' }, ticks: { callback: chartTickNumber } },
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'Barras' }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

// ========================= MATRIZ CONSTRUCTIVA =========================
async function loadMatriz() {
  const container = document.getElementById('matrizContainer');
  const proy = document.getElementById('matrizProyectoFilter').value;
  if (!proy) {
    container.innerHTML = '<div class="muted">Selecciona un proyecto para ver la matriz constructiva</div>';
    return;
  }

  container.innerHTML = '<div class="muted">Cargando matriz...</div>';
  const data = await apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(proy));
  if (!data || !data.items || data.items.length === 0) {
    container.innerHTML = '<div class="muted">Sin datos de sectores para este proyecto</div>';
    return;
  }

  // Build lookup: key = "sector|piso|ciclo" => {barras, kilos}
  const lookup = {};
  let maxKilos = 0;
  data.items.forEach(i => {
    const s = (i.sector || '?').toUpperCase().trim();
    const p = (i.piso || '?').trim();
    const c = (i.ciclo || '?').trim();
    const key = s + '|' + p + '|' + c;
    lookup[key] = { barras: i.barras, kilos: i.kilos };
    if (i.kilos > maxKilos) maxKilos = i.kilos;
  });

  // Collect unique pisos and ciclos
  const pisosSet = new Set();
  const ciclosSet = new Set();
  const sectoresSet = new Set();
  data.items.forEach(i => {
    pisosSet.add((i.piso || '?').trim());
    ciclosSet.add((i.ciclo || '?').trim());
    sectoresSet.add((i.sector || '?').toUpperCase().trim());
  });

  // Sort pisos using global pisoOrder (building order: SM top, subterráneos bottom)
  const pisos = Array.from(pisosSet).sort((a, b) => pisoOrder(a) - pisoOrder(b));
  // Reverse so highest floor is at top of table
  pisos.reverse();

  const ciclos = Array.from(ciclosSet).sort((a, b) => {
    const na = parseInt((a.match(/(\d+)/) || [0,0])[1]);
    const nb = parseInt((b.match(/(\d+)/) || [0,0])[1]);
    return na - nb;
  });

  // Determine sub-row types per piso
  // Standard order top-to-bottom within a piso: LCIELO, VCIELO, ELEV
  // FUND only appears at the lowest piso
  const TYPE_ORDER = ['LCIELO', 'VCIELO', 'ELEV'];
  const lowestPiso = pisos[pisos.length - 1]; // after reverse, last = lowest

  // For each piso, determine which sector types exist
  function getTypesForPiso(piso) {
    const types = [];
    // Check for FUND (only lowest piso typically)
    if (piso === lowestPiso) {
      for (const c of ciclos) {
        if (lookup['FUND|' + piso + '|' + c]) { types.push('FUND'); break; }
      }
    }
    // Always check standard types, but only include if data exists for this piso
    for (const t of TYPE_ORDER) {
      for (const c of ciclos) {
        if (lookup[t + '|' + piso + '|' + c]) { types.push(t); break; }
      }
    }
    // Also check for any other sector types not in standard list
    for (const s of sectoresSet) {
      if (s === 'FUND' || TYPE_ORDER.includes(s)) continue;
      for (const c of ciclos) {
        if (lookup[s + '|' + piso + '|' + c]) { types.push(s); break; }
      }
    }
    return types.length > 0 ? types : ['ELEV']; // fallback
  }

  // Heatmap color function — concrete gray scale
  function heatColor(kilos) {
    if (!kilos || maxKilos === 0) return '#fff';
    const ratio = Math.min(kilos / maxKilos, 1);
    // From light concrete (#D6D6D6) to dark concrete (#6B6B6B)
    const v = Math.round(214 - ratio * (214 - 107));
    return `rgb(${v},${v},${v})`;
  }

  // Load completed sectors from localStorage
  const completedKey = 'armahub_completed_' + proy;
  let completedSectors = {};
  try { completedSectors = JSON.parse(localStorage.getItem(completedKey) || '{}'); } catch(e) {}

  function toggleCompleted(cellKey) {
    if (completedSectors[cellKey]) {
      delete completedSectors[cellKey];
    } else {
      completedSectors[cellKey] = true;
    }
    try { localStorage.setItem(completedKey, JSON.stringify(completedSectors)); } catch(e) {}
    loadMatriz(); // re-render
  }
  // Expose to global scope for onclick
  window._matrizToggle = toggleCompleted;

  // Build HTML table — compact building look
  let html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  html += '<thead><tr><th style="border:1px solid #ccc; padding:4px 6px; background:#1a1a1a; color:#8BC34A; white-space:nowrap;">Piso</th>';
  ciclos.forEach(c => {
    html += `<th style="border:1px solid #ccc; padding:4px 6px; background:#1a1a1a; color:#8BC34A; text-align:center; white-space:nowrap;">${c}</th>`;
  });
  html += '</tr></thead><tbody>';

  pisos.forEach((piso, pisoIdx) => {
    const types = getTypesForPiso(piso);
    types.forEach((tipo, typeIdx) => {
      html += '<tr>';
      if (typeIdx === 0) {
        html += `<td rowspan="${types.length}" style="border:1px solid #ccc; padding:4px 6px; font-weight:bold; background:#fff; color:#1a1a1a; vertical-align:middle; text-align:center; font-size:12px; white-space:nowrap;">${piso}</td>`;
      }
      ciclos.forEach(ciclo => {
        const key = tipo + '|' + piso + '|' + ciclo;
        const d = lookup[key];
        const isCompleted = !!completedSectors[key];
        if (d) {
          const bg = heatColor(d.kilos);
          const textColor = isCompleted ? '#558B2F' : (d.kilos > maxKilos * 0.5 ? '#fff' : '#1a1a1a');
          html += `<td style="border:1px solid #aaa; padding:3px 4px; background:${bg}; text-align:center; position:relative;" title="${tipo} ${piso} ${ciclo}: ${d.barras} barras, ${Math.round(d.kilos).toLocaleString()} kg">`;
          html += `<input type="checkbox" ${isCompleted ? 'checked' : ''} onclick="window._matrizToggle('${key}')" style="position:absolute; top:2px; right:2px; width:12px; height:12px; cursor:pointer; accent-color:#8BC34A;" title="Marcar como completado" />`;
          html += `<div style="font-weight:600; font-size:9px; color:${textColor}; opacity:0.85;">${tipo}</div>`;
          html += `<div style="font-size:11px; font-weight:bold; color:${textColor};">${Math.round(d.kilos).toLocaleString()} kg</div>`;
          html += `<div style="font-size:9px; color:${textColor}; opacity:0.7;">${d.barras} bar</div>`;
          html += '</td>';
        } else {
          html += `<td style="border:1px solid #eee; padding:3px 4px; background:#fff; text-align:center;"></td>`;
        }
      });
      html += '</tr>';
    });
  });

  html += '</tbody></table>';

  // Legend
  html += '<div style="margin-top:8px; display:flex; gap:10px; align-items:center; font-size:11px; flex-wrap:wrap;">';
  html += '<span class="muted">Intensidad (kg):</span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#D6D6D6; border:1px solid #aaa; vertical-align:middle;"></span> <span class="muted">Menos</span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#A8A8A8; border:1px solid #aaa; vertical-align:middle;"></span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#6B6B6B; border:1px solid #aaa; vertical-align:middle;"></span> <span class="muted">Más</span>';
  html += '<span style="margin-left:8px;">☐ = Pendiente</span>';
  html += '<span style="color:#558B2F; font-weight:bold;">☑ = Completado</span>';
  html += '</div>';

  container.innerHTML = html;
}

// ========================= NAVEGADOR DE SECTORES =========================
async function loadSectoresNav() {
  const container = document.getElementById('sectoresNavContainer');
  const proy = document.getElementById('navProyectoFilter').value;
  if (!proy) {
    container.innerHTML = '<div class="muted">Selecciona un proyecto para explorar sus sectores constructivos</div>';
    return;
  }

  container.innerHTML = '<div class="muted">Cargando navegador...</div>';
  const data = await apiGet('/proyectos/' + encodeURIComponent(proy) + '/sectores-nav');
  if (!data || !data.sectores || data.sectores.length === 0) {
    container.innerHTML = '<div class="muted">Sin datos de sectores para este proyecto</div>';
    return;
  }

  const sectores = data.sectores;

  // Sector color map
  const sectorColors = { 'FUND': '#795548', 'ELEV': '#8BC34A', 'LCIELO': '#03A9F4', 'VCIELO': '#FF9800' };

  let html = '';
  sectores.forEach(s => {
    const sc = sectorColors[s.sector] || '#9E9E9E';
    html += '<div class="nav-sector" style="margin-bottom:6px;">';
    html += '<div class="nav-sector-header" onclick="this.parentElement.classList.toggle(\'open\')" style="cursor:pointer; padding:8px 10px; background:#f5f5f5; border-left:4px solid ' + sc + '; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">';
    html += '<div><span style="font-weight:700; font-size:13px; color:' + sc + ';">' + (s.sector || '?') + '</span>';
    html += ' <span class="muted" style="font-size:11px;">' + s.pisos.length + ' pisos</span></div>';
    html += '<div style="text-align:right; font-size:11px;">';
    html += '<span style="font-weight:600;">' + Math.round(s.kilos).toLocaleString() + ' kg</span>';
    html += ' <span class="muted">' + s.barras.toLocaleString() + ' bar</span>';
    html += ' <span style="margin-left:4px; font-size:9px; color:#999;">&#9660;</span></div>';
    html += '</div>';
    html += '<div class="nav-sector-body" style="display:none; padding-left:12px;">';

    s.pisos.forEach(p => {
      html += '<div class="nav-piso" style="margin-top:4px;">';
      html += '<div class="nav-piso-header" onclick="this.parentElement.classList.toggle(\'open\')" style="cursor:pointer; padding:5px 8px; background:#fafafa; border-radius:3px; display:flex; justify-content:space-between; align-items:center; font-size:12px;">';
      html += '<div><span style="font-weight:600;">' + (p.piso || '?') + '</span>';
      html += ' <span class="muted" style="font-size:10px;">' + p.ciclos.length + ' ciclos</span></div>';
      html += '<div style="text-align:right;">';
      html += '<span style="font-weight:500;">' + Math.round(p.kilos).toLocaleString() + ' kg</span>';
      html += ' <span class="muted">' + p.barras.toLocaleString() + ' bar</span>';
      html += ' <span style="margin-left:3px; font-size:8px; color:#999;">&#9660;</span></div>';
      html += '</div>';
      html += '<div class="nav-piso-body" style="display:none; padding-left:10px;">';

      p.ciclos.forEach(c => {
        const dp = c.diam_prom ? c.diam_prom.toFixed(1) : '—';
        html += '<div style="padding:4px 8px; margin-top:2px; background:#fff; border:1px solid #eee; border-radius:3px; font-size:11px; display:flex; justify-content:space-between; align-items:center;">';
        html += '<span style="font-weight:500;">' + (c.ciclo || '?') + '</span>';
        html += '<div style="display:flex; gap:10px; align-items:center;">';
        html += '<span title="Barras">' + c.barras.toLocaleString() + ' bar</span>';
        html += '<span title="Kilos" style="font-weight:600;">' + Math.round(c.kilos).toLocaleString() + ' kg</span>';
        html += '<span title="Ejes distintos" style="color:#666;">' + c.ejes + ' ejes</span>';
        html += '<span title="Diámetro promedio ponderado" style="color:' + sc + '; font-weight:500;">&#x2300; ' + dp + ' mm</span>';
        html += '</div></div>';
      });

      html += '</div></div>';
    });

    html += '</div></div>';
  });

  // Summary bar
  const totalBarras = sectores.reduce((a, s) => a + s.barras, 0);
  const totalKilos = sectores.reduce((a, s) => a + s.kilos, 0);
  const summary = '<div style="margin-bottom:8px; padding:6px 10px; background:#e8f5e9; border-radius:4px; font-size:12px; display:flex; gap:16px;">' +
    '<span><b>' + sectores.length + '</b> sectores</span>' +
    '<span><b>' + totalBarras.toLocaleString() + '</b> barras</span>' +
    '<span><b>' + Math.round(totalKilos).toLocaleString() + '</b> kg</span>' +
    '</div>';

  container.innerHTML = summary + html;
}

// ========================= INICIO (Landing) =========================
// Delegado a features/portal/index.js (E.3)

// ========================= MI ACTIVIDAD (Cubicador dashboard) =========================
// Delegado a features/portal/index.js (E.3)

// ========================= CLIENTES =========================
let _clientesCache = [];

async function loadClientes() {
  const data = await apiGet('/constructoras?activo=true');
  if (!data) return;
  _clientesCache = data.constructoras || [];

  // Populate client selector in crear obra
  const sel = document.getElementById('newObraCliente');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- Sin constructora --</option>' +
      _clientesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    if (prev) sel.value = prev;
  }

  // Populate constructora selector in crear obra desde reclamo
  const recSel = document.getElementById('recNuevoProjConstructora');
  if (recSel) {
    const prev = recSel.value;
    recSel.innerHTML = '<option value="">— Sin constructora —</option>' +
      _clientesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    if (prev) recSel.value = prev;
  }

  // Render client list
  const container = document.getElementById('clientesContainer');
  if (!container) return;
  if (_clientesCache.length === 0) {
    container.innerHTML = '<div class="muted">No hay constructoras registradas</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:6px 8px;">Nombre</th>' +
    '<th style="padding:6px 8px;">RUT</th>' +
    '<th style="padding:6px 8px;">Contacto</th>' +
    '<th style="padding:6px 8px;">Email</th>' +
    '<th style="padding:6px 8px;">Tel</th>' +
    '<th style="padding:6px 8px;">Proyectos</th>' +
    '<th style="padding:6px 8px;">Kilos</th>' +
    '<th style="padding:6px 4px;"></th>' +
    '</tr>' +
    _clientesCache.map(c => `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:5px 8px; font-weight:500;">${c.nombre}</td>
      <td style="padding:5px 8px;" class="muted">${c.rut || '-'}</td>
      <td style="padding:5px 8px;">${c.contacto || '-'}</td>
      <td style="padding:5px 8px;">${c.email || '-'}</td>
      <td style="padding:5px 8px;">${c.telefono || '-'}</td>
      <td style="padding:5px 8px; text-align:center;"><span class="badge">${c.proyectos_count}</span></td>
      <td style="padding:5px 8px; text-align:right;">${c.total_kilos.toFixed(0)} kg</td>
      <td style="padding:5px 4px;">
        <button class="secondary" style="font-size:10px; padding:2px 6px;" onclick="editarCliente(${c.id})">Editar</button>
      </td>
    </tr>`).join('') +
    '</table>';
}

function toggleNuevoCliente() {
  const form = document.getElementById('nuevoClienteForm');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function crearCliente() {
  const nombre = document.getElementById('ncNombre').value.trim();
  const msg = document.getElementById('crearClienteMsg');
  if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';

  const body = { nombre: nombre };
  const rut = document.getElementById('ncRut').value.trim();
  const contacto = document.getElementById('ncContacto').value.trim();
  const email = document.getElementById('ncEmail').value.trim();
  const telefono = document.getElementById('ncTelefono').value.trim();
  if (rut) body.rut = rut;
  if (contacto) body.contacto = contacto;
  if (email) body.email = email;
  if (telefono) body.telefono = telefono;

  const res = await fetch('/constructoras', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.textContent = 'Constructora creada'; msg.style.color = '#558B2F';
    document.getElementById('ncNombre').value = '';
    document.getElementById('ncRut').value = '';
    document.getElementById('ncContacto').value = '';
    document.getElementById('ncEmail').value = '';
    document.getElementById('ncTelefono').value = '';
    document.getElementById('nuevoClienteForm').style.display = 'none';
    await loadClientes();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function editarCliente(clienteId) {
  const c = _clientesCache.find(x => x.id === clienteId);
  if (!c) return;
  const nuevoNombre = prompt('Nombre de la constructora:', c.nombre);
  if (nuevoNombre === null || nuevoNombre.trim() === '') return;
  const body = { nombre: nuevoNombre.trim() };
  const res = await fetch('/constructoras/' + clienteId, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await loadClientes();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

// ========================= CALCULISTAS =========================
let _calculistasCache = [];

async function loadCalculistas() {
  const data = await apiGet('/calculistas?activo=true');
  if (!data) return;
  _calculistasCache = data.calculistas || [];

  // Populate calculista selector in crear obra
  const sel = document.getElementById('newObraCalculista');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- Sin calculista --</option>' +
      _calculistasCache.map(c => '<option value="' + c.id + '">' + c.nombre + '</option>').join('');
    if (prev) sel.value = prev;
  }

  // Populate calculista selector in crear obra desde reclamo
  const recSel = document.getElementById('recNuevoProjCalculista');
  if (recSel) {
    const prev = recSel.value;
    recSel.innerHTML = '<option value="">— Sin calculista —</option>' +
      _calculistasCache.map(c => '<option value="' + c.id + '">' + c.nombre + '</option>').join('');
    if (prev) recSel.value = prev;
  }

  // Render calculista list
  const container = document.getElementById('calculistasContainer');
  if (!container) return;
  if (_calculistasCache.length === 0) {
    container.innerHTML = '<div class="muted">No hay calculistas registrados</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:6px 8px;">Nombre</th>' +
    '<th style="padding:6px 8px;">Email</th>' +
    '<th style="padding:6px 8px;">Proyectos</th>' +
    '<th style="padding:6px 8px;">Barras</th>' +
    '<th style="padding:6px 8px;">Kilos</th>' +
    '<th style="padding:6px 4px;"></th>' +
    '</tr>' +
    _calculistasCache.map(c => '<tr style="border-bottom:1px solid #eee;">' +
      '<td style="padding:5px 8px; font-weight:500;">' + c.nombre + '</td>' +
      '<td style="padding:5px 8px;" class="muted">' + (c.email || '-') + '</td>' +
      '<td style="padding:5px 8px; text-align:center;"><span class="badge">' + c.proyectos_count + '</span></td>' +
      '<td style="padding:5px 8px; text-align:right;">' + c.total_barras.toLocaleString() + '</td>' +
      '<td style="padding:5px 8px; text-align:right;">' + c.total_kilos.toFixed(0) + ' kg</td>' +
      '<td style="padding:5px 4px;">' +
        '<button class="secondary" style="font-size:10px; padding:2px 6px;" onclick="editarCalculista(' + c.id + ')">Editar</button>' +
      '</td>' +
    '</tr>').join('') +
    '</table>';
}

function toggleNuevoCalculista() {
  const form = document.getElementById('nuevoCalculistaForm');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function crearCalculista() {
  const nombre = document.getElementById('nCalcNombre').value.trim();
  const msg = document.getElementById('crearCalculistaMsg');
  if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';

  const body = { nombre: nombre };
  const email = document.getElementById('nCalcEmail').value.trim();
  if (email) body.email = email;

  const res = await fetch('/calculistas', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.textContent = 'Calculista creado'; msg.style.color = '#558B2F';
    document.getElementById('nCalcNombre').value = '';
    document.getElementById('nCalcEmail').value = '';
    document.getElementById('nuevoCalculistaForm').style.display = 'none';
    await loadCalculistas();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function editarCalculista(calcId) {
  const c = _calculistasCache.find(x => x.id === calcId);
  if (!c) return;
  const nuevoNombre = prompt('Nombre del calculista:', c.nombre);
  if (nuevoNombre === null || nuevoNombre.trim() === '') return;
  const body = { nombre: nuevoNombre.trim() };
  const res = await fetch('/calculistas/' + calcId, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await loadCalculistas();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

// ========================= ADMIN PROYECTOS =========================
var _adminProyectosCache = [];

async function loadAdminProyectos() {
  var container = document.getElementById('adminProyectosContainer');
  if (!container) return;
  var data = await apiGet('/proyectos');
  if (!data || !data.proyectos) { container.innerHTML = '<div class="muted">Error cargando proyectos</div>'; return; }
  _adminProyectosCache = data.proyectos;
  if (_adminProyectosCache.length === 0) { container.innerHTML = '<div class="muted">No hay proyectos</div>'; return; }

  var html = '<table style="width:100%; font-size:11px; border-collapse:collapse;">';
  html += '<tr style="background:#f5f5f5; text-align:left;">';
  html += '<th style="padding:5px 6px;">Nombre</th>';
  html += '<th style="padding:5px 6px;">ID</th>';
  html += '<th style="padding:5px 6px;">Calculista</th>';
  html += '<th style="padding:5px 6px;">Constructora</th>';
  html += '<th style="padding:5px 6px;">Barras</th>';
  html += '<th style="padding:5px 6px;">Kilos</th>';
  html += '<th style="padding:5px 6px;">Creador</th>';
  html += '<th style="padding:5px 6px;">Acciones</th></tr>';

  _adminProyectosCache.forEach(function(p) {
    var kilos = p.total_kilos ? Math.round(p.total_kilos).toLocaleString('es-CL') : '0';
    var calc = p.calculista_nombre || '<span class="muted">-</span>';
    var cliente = p.constructora_nombre || '<span class="muted">-</span>';
    var creador = p.usuario_creador || '<span class="muted">-</span>';
    html += '<tr style="border-bottom:1px solid #eee;">';
    html += '<td style="padding:4px 6px; font-weight:500; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + p.nombre_proyecto + '</td>';
    html += '<td style="padding:4px 6px; font-size:10px;" class="muted">' + p.id_proyecto + '</td>';
    html += '<td style="padding:4px 6px;">' + calc + '</td>';
    html += '<td style="padding:4px 6px;">' + cliente + '</td>';
    html += '<td style="padding:4px 6px; text-align:center;"><span class="badge">' + (p.total_barras || 0) + '</span></td>';
    html += '<td style="padding:4px 6px; text-align:right; font-weight:500;">' + kilos + '</td>';
    html += '<td style="padding:4px 6px; font-size:10px;" class="muted">' + creador + '</td>';
    html += '<td style="padding:4px 6px; white-space:nowrap;">';
    html += '<button class="secondary" style="font-size:10px; padding:1px 6px;" onclick="editarProyectoAdmin(\'' + p.id_proyecto + '\')">Editar</button>';
    html += '</td></tr>';
  });
  html += '</table>';
  html += '<div class="muted" style="font-size:11px; margin-top:6px;">Total: ' + _adminProyectosCache.length + ' proyecto(s)</div>';
  container.innerHTML = html;
}

async function editarProyectoAdmin(idProyecto) {
  var p = _adminProyectosCache.find(function(x) { return x.id_proyecto === idProyecto; });
  if (!p) return;

  // Build a simple modal-like edit form
  var container = document.getElementById('adminProyectosContainer');
  var calcOpts = '<option value="0">— Sin calculista —</option>' +
    _calculistasCache.map(function(c) {
      return '<option value="' + c.id + '"' + (c.id === p.calculista_id ? ' selected' : '') + '>' + c.nombre + '</option>';
    }).join('');

  var clienteData = [];
  try {
    var cdata = await apiGet('/constructoras');
    clienteData = (cdata && cdata.constructoras) ? cdata.constructoras : [];
  } catch(e) {}
  var clienteOpts = '<option value="0">— Sin constructora —</option>' +
    clienteData.map(function(c) {
      return '<option value="' + c.id + '"' + (c.id === p.constructora_id ? ' selected' : '') + '>' + c.nombre + '</option>';
    }).join('');

  var formHtml = '<div style="padding:12px; background:#e3f2fd; border:1px solid #90caf9; border-radius:8px; margin-bottom:10px;">';
  formHtml += '<h4 style="margin:0 0 10px 0; color:#1565C0; font-size:13px;">Editando: ' + p.nombre_proyecto + '</h4>';
  formHtml += '<div class="row" style="gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:6px;">';
  formHtml += '<div class="col" style="flex:2; min-width:200px;"><label style="font-size:11px; color:#666;">Nombre del proyecto *</label>';
  formHtml += '<input type="text" id="editProjNombre" value="' + (p.nombre_proyecto || '').replace(/"/g, '&quot;') + '" style="width:100%; font-size:12px;" /></div>';
  formHtml += '</div>';
  formHtml += '<div class="row" style="gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:6px;">';
  formHtml += '<div class="col" style="flex:1; min-width:180px;"><label style="font-size:11px; color:#666;">Calculista</label>';
  formHtml += '<div style="display:flex; gap:4px;"><select id="editProjCalculista" style="flex:1; font-size:12px;">' + calcOpts + '</select>';
  formHtml += '<button class="secondary" style="font-size:11px; padding:2px 7px; white-space:nowrap;" onclick="toggleAdminProjNewCalc()">+ Nuevo</button></div>';
  formHtml += '<div id="adminProjNewCalcForm" style="display:none; margin-top:3px; padding:5px; background:#fff; border-radius:4px;"><div style="display:flex; gap:3px;">';
  formHtml += '<input type="text" id="adminProjNewCalcNombre" placeholder="Nombre calculista" style="flex:1; font-size:11px;" />';
  formHtml += '<button onclick="crearCalcDesdeAdminProj()" style="font-size:10px; padding:2px 7px;">Crear</button></div>';
  formHtml += '<span id="adminProjNewCalcMsg" style="font-size:10px;"></span></div></div>';
  formHtml += '<div class="col" style="flex:1; min-width:180px;"><label style="font-size:11px; color:#666;">Constructora</label>';
  formHtml += '<div style="display:flex; gap:4px;"><select id="editProjCliente" style="flex:1; font-size:12px;">' + clienteOpts + '</select>';
  formHtml += '<button class="secondary" style="font-size:11px; padding:2px 7px; white-space:nowrap;" onclick="toggleAdminProjNewConst()">+ Nueva</button></div>';
  formHtml += '<div id="adminProjNewConstForm" style="display:none; margin-top:3px; padding:5px; background:#fff; border-radius:4px;"><div style="display:flex; gap:3px;">';
  formHtml += '<input type="text" id="adminProjNewConstNombre" placeholder="Nombre constructora" style="flex:1; font-size:11px;" />';
  formHtml += '<button onclick="crearConstDesdeAdminProj()" style="font-size:10px; padding:2px 7px;">Crear</button></div>';
  formHtml += '<span id="adminProjNewConstMsg" style="font-size:10px;"></span></div></div>';
  formHtml += '</div>';
  formHtml += '<div style="margin-bottom:8px;"><label style="font-size:11px; color:#666;">Descripción</label>';
  formHtml += '<textarea id="editProjDescripcion" rows="2" style="width:100%; font-size:12px; resize:vertical;">' + (p.descripcion || '') + '</textarea></div>';
  // Usuarios autorizados section
  formHtml += '<div style="padding:8px; background:#fff; border-radius:6px; margin-bottom:8px;">';
  formHtml += '<div style="font-size:11px; font-weight:600; margin-bottom:5px;">Usuarios autorizados</div>';
  formHtml += '<div id="adminProjAutorizadosList" class="muted" style="font-size:11px; min-height:16px; margin-bottom:6px;">Cargando...</div>';
  formHtml += '<div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">';
  formHtml += '<select id="adminProjUserSel" style="flex:2; min-width:130px; font-size:11px;"><option>Cargando...</option></select>';
  formHtml += '<select id="adminProjUserRol" style="width:100px; font-size:11px;">';
  formHtml += '<option value="admin">Admin</option><option value="cubicador" selected>Cubicador</option>';
  formHtml += '<option value="usc">USC</option><option value="externo">Externo</option><option value="cliente">Cliente</option></select>';
  formHtml += '<button onclick="autorizarUsuarioAdminProj(\'' + p.id_proyecto + '\')" style="font-size:10px; padding:3px 8px;">+ Agregar</button>';
  formHtml += '</div></div>';
  formHtml += '<div style="display:flex; gap:6px; align-items:center;">';
  formHtml += '<button onclick="guardarProyectoAdmin(\'' + p.id_proyecto + '\')" style="font-size:11px; padding:4px 14px;">💾 Guardar</button>';
  formHtml += '<button class="secondary" onclick="loadAdminProyectos()" style="font-size:11px; padding:4px 10px;">Cancelar</button>';
  formHtml += '<span id="editProjMsg" class="muted" style="font-size:11px;"></span>';
  formHtml += '</div></div>';

  // Prepend form above the table
  container.insertAdjacentHTML('afterbegin', formHtml);
  document.getElementById('editProjNombre').focus();

  // Load users and autorizados
  var userSel = document.getElementById('adminProjUserSel');
  var usersData = await apiGet('/users/list');
  if (usersData && usersData.users) {
    userSel.innerHTML = usersData.users.map(function(u) {
      var label = [u.nombre, u.apellido].filter(Boolean).join(' ');
      return '<option value="' + u.id + '">' + (label ? label + ' (' + u.email + ')' : u.email) + '</option>';
    }).join('');
  }
  await loadAutorizadosAdminProj(p.id_proyecto);
}

async function loadAutorizadosAdminProj(idProyecto) {
  var list = document.getElementById('adminProjAutorizadosList');
  if (!list) return;
  var data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizados');
  if (!data || !data.autorizados) { list.innerHTML = '<span class="muted">Error</span>'; return; }
  if (data.autorizados.length === 0) { list.innerHTML = '<span class="muted">Sin usuarios autorizados</span>'; return; }
  var rolColors = {admin:'#1565C0', usc:'#FF9800', cubicador:'#8BC34A', externo:'#9C27B0', cliente:'#607D8B'};
  list.innerHTML = data.autorizados.map(function(a) {
    var nombre = [a.nombre, a.apellido].filter(Boolean).join(' ');
    var display = nombre ? nombre + ' (' + a.email + ')' : a.email;
    var rc = rolColors[a.rol] || '#666';
    return '<div style="display:inline-flex; align-items:center; gap:4px; margin:1px 4px 1px 0;">' +
      '<span style="font-size:10px; padding:1px 5px; border-radius:3px; background:' + rc + '22; color:' + rc + '; font-weight:600;">' + a.rol.toUpperCase() + '</span>' +
      '<span style="font-size:11px;">' + display + '</span>' +
      '<button class="secondary" style="font-size:9px; padding:0px 4px; color:#b42318; border-color:#b42318;" onclick="revocarUsuarioAdminProj(\'' + idProyecto + '\',' + a.user_id + ')">&#10005;</button>' +
      '</div>';
  }).join('');
}

async function autorizarUsuarioAdminProj(idProyecto) {
  var userId = parseInt(document.getElementById('adminProjUserSel').value);
  var rol = document.getElementById('adminProjUserRol').value;
  if (!userId) return;
  var res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, rol: rol })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    await loadAutorizadosAdminProj(idProyecto);
  } else {
    var msg = document.getElementById('editProjMsg');
    if (msg) { msg.textContent = data.detail || 'Error'; msg.style.color = '#b42318'; }
  }
}

async function revocarUsuarioAdminProj(idProyecto, userId) {
  if (!confirm('\u00bfRevocar acceso?')) return;
  var res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar/' + userId, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) await loadAutorizadosAdminProj(idProyecto);
}

function toggleAdminProjNewCalc() {
  var f = document.getElementById('adminProjNewCalcForm');
  if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearCalcDesdeAdminProj() {
  var nombre = document.getElementById('adminProjNewCalcNombre').value.trim();
  var msg = document.getElementById('adminProjNewCalcMsg');
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
    document.getElementById('adminProjNewCalcNombre').value = '';
    await loadCalculistas();
    var sel = document.getElementById('editProjCalculista');
    if (sel) {
      sel.innerHTML = '<option value="0">\u2014 Sin calculista \u2014</option>' +
        _calculistasCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
      sel.value = data.id;
    }
    document.getElementById('adminProjNewCalcForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

function toggleAdminProjNewConst() {
  var f = document.getElementById('adminProjNewConstForm');
  if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearConstDesdeAdminProj() {
  var nombre = document.getElementById('adminProjNewConstNombre').value.trim();
  var msg = document.getElementById('adminProjNewConstMsg');
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
    document.getElementById('adminProjNewConstNombre').value = '';
    await loadClientes();
    var sel = document.getElementById('editProjCliente');
    if (sel) {
      sel.innerHTML = '<option value="0">\u2014 Sin constructora \u2014</option>' +
        _clientesCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
      sel.value = data.id;
    }
    document.getElementById('adminProjNewConstForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function guardarProyectoAdmin(idProyecto) {
  var msg = document.getElementById('editProjMsg');
  var nombre = document.getElementById('editProjNombre').value.trim();
  if (!nombre) { msg.textContent = 'El nombre es obligatorio'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';

  var body = {
    nombre_proyecto: nombre,
    descripcion: document.getElementById('editProjDescripcion').value.trim() || '',
    calculista_id: parseInt(document.getElementById('editProjCalculista').value) || 0,
    constructora_id: parseInt(document.getElementById('editProjCliente').value) || 0,
  };

  var res = await fetch('/proyectos/' + idProyecto, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Guardado'; msg.style.color = '#558B2F';
    await loadAdminProyectos();
    // Also refresh project selectors elsewhere
    await loadProyectos();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

// ========================= PEDIDOS =========================
let _pedidoActual = null;

async function loadPedidos() {
  const container = document.getElementById('pedidosList');
  const estado = document.getElementById('pedidoFiltroEstado').value;
  let url = '/pedidos';
  const params = [];
  if (estado) params.push('estado=' + encodeURIComponent(estado));
  if (params.length) url += '?' + params.join('&');

  const data = await apiGet(url);
  if (!data || !data.pedidos) { container.innerHTML = '<div class="muted">Error cargando pedidos</div>'; return; }
  if (data.pedidos.length === 0) { container.innerHTML = '<div class="muted">No hay pedidos</div>'; return; }

  const estadoColors = { borrador: '#9E9E9E', enviado: '#2196F3', en_proceso: '#FF9800', completado: '#8BC34A', cancelado: '#b42318' };

  container.innerHTML = data.pedidos.map(p => {
    const sc = estadoColors[p.estado] || '#666';
    const fecha = p.fecha_creacion ? p.fecha_creacion.substring(0, 10) : '';
    var tipoBadge = p.tipo === 'especifico'
      ? '<span style="font-size:9px; padding:1px 5px; border-radius:3px; background:#E3F2FD; color:#1565C0;">específico</span>'
      : '<span style="font-size:9px; padding:1px 5px; border-radius:3px; background:#FFF3E0; color:#E65100;">genérico</span>';
    var procBadge = p.procesado ? ' <span style="font-size:9px; padding:1px 5px; border-radius:3px; background:#E8F5E9; color:#2E7D32;">✓ procesado</span>' : '';
    return '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid #f0f0f0; cursor:pointer;" onclick="openPedido(' + p.id + ')">' +
      '<div>' +
        '<span style="font-weight:600; font-size:13px;">' + (p.titulo || 'Sin título') + '</span>' +
        ' <span class="muted" style="font-size:11px;">#' + p.id + '</span> ' + tipoBadge + procBadge +
        '<div class="muted" style="font-size:11px;">' + (p.nombre_proyecto || p.id_proyecto) + ' · ' + p.total_items + ' items · ' + fecha + '</div>' +
      '</div>' +
      '<span style="font-size:11px; padding:2px 8px; border-radius:10px; background:' + sc + '22; color:' + sc + '; font-weight:500;">' + p.estado + '</span>' +
    '</div>';
  }).join('');
}

async function crearPedido() {
  const proy = document.getElementById('pedidoProyecto').value;
  const titulo = document.getElementById('pedidoTitulo').value.trim();
  const msg = document.getElementById('pedidoCreateMsg');
  if (!proy) { msg.innerHTML = '<span class="status-err">Selecciona un proyecto</span>'; return; }
  if (!titulo) { msg.innerHTML = '<span class="status-err">Ingresa un título</span>'; return; }

  var tipo = document.getElementById('pedidoTipo').value || 'generico';
  const res = await apiPostJson('/pedidos', { id_proyecto: proy, titulo: titulo, tipo: tipo });
  if (res && res.ok) {
    msg.innerHTML = '<span class="status-ok">Pedido #' + res.id + ' creado (' + tipo + ')</span>';
    document.getElementById('pedidoTitulo').value = '';
    await loadPedidos();
    openPedido(res.id);
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (res?.detail || 'desconocido') + '</span>';
  }
}

async function openPedido(id) {
  _pedidoActual = id;
  const card = document.getElementById('pedidoDetailCard');
  card.style.display = '';

  const data = await apiGet('/pedidos/' + id);
  if (!data) { card.style.display = 'none'; return; }

  document.getElementById('pedidoDetailTitle').textContent = data.titulo || 'Sin título';
  var tipoLabel = data.tipo === 'especifico' ? 'Específico' : 'Genérico';
  document.getElementById('pedidoDetailMeta').textContent =
    (data.nombre_proyecto || data.id_proyecto) + ' · ' + tipoLabel + ' · Creado por ' + (data.creado_por || '—') +
    ' · ' + (data.fecha_creacion || '').substring(0, 10);
  document.getElementById('pedidoDetailEstado').value = data.estado;

  // Show/hide procesar button
  var btnProc = document.getElementById('btnProcesarPedido');
  if (btnProc) {
    btnProc.style.display = (!data.procesado && (data.estado === 'enviado' || data.estado === 'en_proceso') && data.items && data.items.length > 0) ? '' : 'none';
  }

  // Show/hide sector/piso/ciclo fields based on tipo
  var isEspecifico = data.tipo === 'especifico';
  var sg = document.getElementById('itemSectorGroup');
  var pg = document.getElementById('itemPisoGroup');
  var cg = document.getElementById('itemCicloGroup');
  if (sg) sg.style.display = isEspecifico ? '' : 'none';
  if (pg) pg.style.display = isEspecifico ? '' : 'none';
  if (cg) cg.style.display = isEspecifico ? '' : 'none';

  // Store tipo on the detail card for use by agregarItemPedido
  document.getElementById('pedidoDetailCard').dataset.tipo = data.tipo || 'generico';
  document.getElementById('pedidoDetailCard').dataset.procesado = data.procesado ? '1' : '0';

  const tbody = document.getElementById('pedidoItemsBody');
  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="muted">Sin items — agrega barras arriba</td></tr>';
  } else {
    const estadoItemColors = { pendiente: '#9E9E9E', en_proceso: '#FF9800', completado: '#8BC34A' };
    tbody.innerHTML = data.items.map(i => {
      const ic = estadoItemColors[i.estado] || '#666';
      return '<tr>' +
        '<td>' + (i.eje || '') + '</td>' +
        '<td style="font-weight:600;">' + i.diam + '</td>' +
        '<td>' + (i.largo || '—') + '</td>' +
        '<td>' + i.cantidad + '</td>' +
        '<td>' + (i.sector || '—') + '</td>' +
        '<td>' + (i.piso || '—') + '</td>' +
        '<td>' + (i.ciclo || '—') + '</td>' +
        '<td class="muted">' + (i.nota || '') + '</td>' +
        '<td><span style="font-size:10px; padding:1px 6px; border-radius:8px; background:' + ic + '22; color:' + ic + ';">' + i.estado + '</span></td>' +
        '<td><button onclick="eliminarItemPedido(' + id + ',' + i.id + ')" style="font-size:10px; padding:2px 6px; background:#fff; border:1px solid #ddd; color:#b42318; cursor:pointer;" title="Eliminar item">✕</button></td>' +
      '</tr>';
    }).join('');
  }
}

async function cambiarEstadoPedido() {
  if (!_pedidoActual) return;
  const estado = document.getElementById('pedidoDetailEstado').value;
  const msg = document.getElementById('pedidoDetailMsg');
  const res = await fetch('/pedidos/' + _pedidoActual, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: estado })
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.innerHTML = '<span class="status-ok">Estado actualizado a: ' + estado + '</span>';
    await loadPedidos();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || 'desconocido') + '</span>';
  }
}

async function eliminarPedido() {
  if (!_pedidoActual) return;
  if (!confirm('¿Eliminar este pedido y todos sus items?')) return;
  const res = await apiDelete('/pedidos/' + _pedidoActual);
  if (res && res.ok) {
    document.getElementById('pedidoDetailCard').style.display = 'none';
    _pedidoActual = null;
    await loadPedidos();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

async function agregarItemPedido() {
  if (!_pedidoActual) return;
  var eje = (document.getElementById('itemEje').value || '').trim() || null;
  const diam = parseFloat(document.getElementById('itemDiam').value);
  const largo = parseFloat(document.getElementById('itemLargo').value) || null;
  const cantidad = parseInt(document.getElementById('itemCant').value) || 1;
  const sector = document.getElementById('itemSector').value || null;
  var piso = (document.getElementById('itemPiso').value || '').trim().toUpperCase() || null;
  var ciclo = (document.getElementById('itemCiclo').value || '').trim().toUpperCase() || null;
  const nota = document.getElementById('itemNota').value.trim() || null;
  const msg = document.getElementById('pedidoDetailMsg');

  if (!diam || isNaN(diam)) { msg.innerHTML = '<span class="status-err">Ingresa diámetro</span>'; return; }

  var body = { diam: diam, largo: largo, cantidad: cantidad, nota: nota };
  if (eje) body.eje = eje;
  if (sector) body.sector = sector;
  if (piso) body.piso = piso;
  if (ciclo) body.ciclo = ciclo;

  const res = await apiPostJson('/pedidos/' + _pedidoActual + '/items', body);
  if (res && res.ok) {
    document.getElementById('itemEje').value = '';
    document.getElementById('itemDiam').value = '';
    document.getElementById('itemLargo').value = '';
    document.getElementById('itemCant').value = '1';
    document.getElementById('itemSector').value = '';
    document.getElementById('itemPiso').value = '';
    document.getElementById('itemCiclo').value = '';
    document.getElementById('itemNota').value = '';
    msg.innerHTML = '<span class="status-ok">Item agregado</span>';
    await openPedido(_pedidoActual);
    await loadPedidos();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (res?.detail || 'desconocido') + '</span>';
  }
}

async function eliminarItemPedido(pedidoId, itemId) {
  if (!confirm('¿Eliminar este item?')) return;
  const res = await apiDelete('/pedidos/' + pedidoId + '/items/' + itemId);
  if (res && res.ok) {
    await openPedido(pedidoId);
    await loadPedidos();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

async function procesarPedido() {
  if (!_pedidoActual) return;
  if (!confirm('¿Procesar este pedido? Se generarán barras en la cubicación del proyecto. Esta acción no se puede deshacer.')) return;
  var msg = document.getElementById('pedidoDetailMsg');
  msg.innerHTML = '<span class="muted">Procesando...</span>';
  var res = await fetch('/pedidos/' + _pedidoActual + '/procesar', {
    method: 'POST', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.innerHTML = '<span class="status-ok">Pedido procesado: ' + data.barras_creadas + ' barras generadas</span>';
    await openPedido(_pedidoActual);
    await loadPedidos();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || 'desconocido') + '</span>';
  }
}

// ========================= ADMIN =========================
const TABLE_LABELS = {
  barras: 'Barras', imports: 'Importaciones', proyectos: 'Proyectos',
  reclamos: 'Reclamos', calculistas: 'Calculistas', clientes: 'Constructoras',
  pedidos: 'Pedidos', audit_log: 'Auditoría', users: 'Usuarios',
};
const CLEARABLE_TABLES = ['barras','imports','proyectos','reclamos','calculistas','clientes','pedidos','audit_log'];

async function loadTableCounts() {
  const container = document.getElementById('tableCountsContainer');
  if (!container) return;
  const data = await apiGet('/admin/tables');
  if (!data || !data.tables) { container.innerHTML = '<div class="muted">Error al cargar</div>'; return; }
  let html = '<table style="width:100%; font-size:12px;"><thead><tr><th style="text-align:left;">Tabla</th><th style="text-align:right;">Registros</th><th></th></tr></thead><tbody>';
  data.tables.forEach(t => {
    const label = TABLE_LABELS[t.table] || t.table;
    const canClear = CLEARABLE_TABLES.includes(t.table);
    const clearBtn = canClear && t.count > 0
      ? `<button class="secondary" style="font-size:10px; padding:2px 8px; color:#b42318;" onclick="clearTable('${t.table}')">Limpiar</button>`
      : '';
    html += `<tr><td>${label}</td><td style="text-align:right; font-weight:600;">${t.count.toLocaleString()}</td><td style="text-align:right;">${clearBtn}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function clearTable(tableName) {
  const label = TABLE_LABELS[tableName] || tableName;
  if (!window.confirm(`¿Limpiar TODOS los registros de "${label}"? Esta acción no se puede deshacer.`)) return;
  const input = prompt(`Escribe CONFIRMAR para limpiar la tabla "${label}":`);
  if (input !== 'CONFIRMAR') { alert('Operación cancelada.'); return; }
  const res = await fetch('/admin/tables/' + encodeURIComponent(tableName) + '/clear?confirm=CONFIRMAR', {
    method: 'POST', headers: authHeaders()
  }).then(r => r.json()).catch(() => null);
  if (res && res.ok) {
    alert(`Tabla "${label}" limpiada correctamente.`);
    loadTableCounts();
    loadDbInfo();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

async function loadDbInfo() {
  const data = await apiGet('/admin/db-info');
  if (!data) return;
  document.getElementById('dbInfoContainer').innerHTML = `
    <div class="row">
      <div class="card" style="flex:1; text-align:center; margin:4px;">
        <div style="font-size:28px; font-weight:bold; color:#8BC34A;">${data.barras}</div>
        <div class="muted">Barras</div>
      </div>
      <div class="card" style="flex:1; text-align:center; margin:4px;">
        <div style="font-size:28px; font-weight:bold; color:#8BC34A;">${data.proyectos}</div>
        <div class="muted">Proyectos</div>
      </div>
      <div class="card" style="flex:1; text-align:center; margin:4px;">
        <div style="font-size:28px; font-weight:bold; color:#8BC34A;">${data.usuarios}</div>
        <div class="muted">Usuarios</div>
      </div>
      <div class="card" style="flex:1; text-align:center; margin:4px;">
        <div style="font-size:28px; font-weight:bold; color:#8BC34A;">${data.kilos_totales.toFixed(0)}</div>
        <div class="muted">Kilos totales</div>
      </div>
    </div>
  `;
}

async function resetDatabase() {
  const confirm = document.getElementById('resetConfirm').value.trim();
  const keepUsers = document.getElementById('resetKeepUsers').checked;
  const msg = document.getElementById('resetMsg');

  if (confirm !== 'CONFIRMAR') {
    msg.textContent = 'Debes escribir CONFIRMAR para ejecutar el reset.';
    msg.className = 'status-err';
    return;
  }

  if (!window.confirm('¿Estás seguro? Esta acción eliminará TODOS los datos de barras y proyectos.')) {
    return;
  }

  msg.textContent = 'Reseteando...';
  msg.className = 'status-warn';

  const params = new URLSearchParams({ confirm: 'CONFIRMAR', keep_users: keepUsers });
  const res = await fetch('/admin/reset-db?' + params.toString(), {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json();

  if (!res.ok) {
    msg.textContent = 'Error: ' + (data.detail || JSON.stringify(data));
    msg.className = 'status-err';
    return;
  }

  const r = data.reset;
  msg.textContent = `Reset completo. Eliminadas: ${r.barras_eliminadas} barras, ${r.proyectos_eliminados} proyectos.`;
  msg.className = 'status-ok';
  document.getElementById('resetConfirm').value = '';

  await loadDbInfo();
  await loadProyectos();
  await loadFilters();
  await loadDashboard('sector');
}

function toggleNuevoUsuario() {
  var f = document.getElementById('nuevoUsuarioForm');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function createUser() {
  var email = document.getElementById('newUserEmail').value.trim();
  var nombre = document.getElementById('newUserNombre') ? document.getElementById('newUserNombre').value.trim() : '';
  var apellido = document.getElementById('newUserApellido') ? document.getElementById('newUserApellido').value.trim() : '';
  var password = document.getElementById('newUserPassword').value;
  var role = document.getElementById('newUserRole').value;
  var msg = document.getElementById('createUserMsg');
  if (!email || !password) { msg.textContent = 'Email y contrasena son requeridos.'; msg.style.color = '#b42318'; return; }
  var params = new URLSearchParams({ email: email, password: password, role: role, nombre: nombre, apellido: apellido });
  var res = await fetch('/auth/register?' + params.toString(), { method: 'POST', headers: authHeaders() });
  var data = await res.json();
  if (!res.ok) { msg.textContent = 'Error: ' + (data.detail || JSON.stringify(data)); msg.style.color = '#b42318'; return; }
  msg.textContent = 'Usuario ' + email + ' (' + role + ') creado.'; msg.style.color = '#558B2F';
  document.getElementById('newUserEmail').value = '';
  if (document.getElementById('newUserNombre')) document.getElementById('newUserNombre').value = '';
  if (document.getElementById('newUserApellido')) document.getElementById('newUserApellido').value = '';
  document.getElementById('newUserPassword').value = '';
  await loadUsers();
}

var _roleColors = { admin: '#b42318', admin2: '#1565C0', cubicador: '#2e7d32', usc: '#ff9800', externo: '#795548', cliente: '#7B1FA2' };
var _roleLabels = { admin: 'Admin', admin2: 'Admin2', cubicador: 'Cubicador', usc: 'USC', externo: 'Externo', cliente: 'Cliente' };

async function loadUsers() {
  var container = document.getElementById('usersListContainer');
  if (!container) return;
  var res = await fetch('/admin/users', { headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  if (!res.ok) { container.innerHTML = '<div class="muted">Error cargando usuarios</div>'; return; }
  var data = await res.json();
  if (!data.users || data.users.length === 0) { container.innerHTML = '<div class="muted">No hay usuarios</div>'; return; }
  var html = '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
  html += '<tr style="background:#f5f5f5; text-align:left;">';
  html += '<th style="padding:5px 6px;">Email</th><th style="padding:5px 6px;">Nombre</th>';
  html += '<th style="padding:5px 6px;">Rol</th><th style="padding:5px 6px;">Estado</th>';
  html += '<th style="padding:5px 6px;">Creado</th><th style="padding:5px 6px;">Acciones</th></tr>';
  data.users.forEach(function(u) {
    var rColor = _roleColors[u.role] || '#666';
    var activo = u.activo !== false;
    var activoBadge = activo ? '<span style="color:#2e7d32; font-weight:600; font-size:10px;">Activo</span>' : '<span style="color:#b42318; font-weight:600; font-size:10px;">Inactivo</span>';
    var fecha = u.fecha_creacion ? u.fecha_creacion.substring(0, 10) : '-';
    var toggleLabel = activo ? 'Desactivar' : 'Activar';
    var toggleColor = activo ? '#b42318' : '#2e7d32';
    var _rolLabels = {admin:'Admin',admin2:'Admin2',cubicador:'Cubicador',usc:'USC',externo:'Externo',cliente:'Cliente'};
    var allRoles = ['admin','admin2','cubicador','usc','externo','cliente'];
    var rolOpts = allRoles.map(function(r) {
      return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + (_rolLabels[r] || r) + '</option>';
    }).join('');
    var rowStyle = 'border-bottom:1px solid #eee;' + (!activo ? ' background:#fafafa; opacity:0.7;' : '');
    html += '<tr style="' + rowStyle + '">';
    var displayName = ((u.nombre || '') + ' ' + (u.apellido || '')).trim();
    html += '<td style="padding:4px 6px; font-weight:500;">' + u.email + '</td>';
    html += '<td style="padding:4px 6px;">' + (displayName || '<span class="muted">-</span>') + '</td>';
    // Role column: admin sees dropdown, admin2 sees label only
    if (currentRole === 'admin') {
      html += '<td style="padding:4px 6px;"><select style="font-size:11px; color:' + rColor + '; font-weight:600; border:1px solid #ddd; border-radius:3px; padding:1px 4px;" onchange="cambiarRolUsuario(' + u.id + ', this.value)">' + rolOpts + '</select></td>';
    } else {
      html += '<td style="padding:4px 6px;"><span style="font-size:11px; color:' + rColor + '; font-weight:600;">' + (_rolLabels[u.role] || u.role) + '</span></td>';
    }
    html += '<td style="padding:4px 6px;">' + activoBadge + '</td>';
    html += '<td style="padding:4px 6px; font-size:11px;" class="muted">' + fecha + '</td>';
    html += '<td style="padding:4px 6px; white-space:nowrap;">';
    html += '<button class="secondary" style="font-size:10px; padding:1px 6px;" onclick="editarNombreUsuario(' + u.id + ', \'' + (u.nombre || '').replace(/'/g, "\\'") + '\', \'' + (u.apellido || '').replace(/'/g, "\\'") + '\')">Nombre</button> ';
    html += '<button class="secondary" style="font-size:10px; padding:1px 6px; color:' + toggleColor + ';" onclick="toggleActivoUsuario(' + u.id + ', ' + !activo + ')">' + toggleLabel + '</button> ';
    html += '<button class="secondary" style="font-size:10px; padding:1px 6px;" onclick="resetPasswordUsuario(' + u.id + ')">Cambiar clave</button> ';
    // Delete: admin only
    if (currentRole === 'admin') {
      html += '<button class="secondary" style="font-size:10px; padding:1px 6px; color:#b42318;" onclick="eliminarUsuarioAdmin(' + u.id + ')">Eliminar</button>';
    }
    html += '</td></tr>';
  });
  html += '</table>';
  html += '<div class="muted" style="font-size:11px; margin-top:6px;">Total: ' + data.users.length + ' usuario(s)</div>';
  container.innerHTML = html;
}

async function cambiarRolUsuario(userId, nuevoRol) {
  var params = new URLSearchParams({ role: nuevoRol });
  var res = await fetch('/admin/users/' + userId + '/role?' + params.toString(), { method: 'PATCH', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (!data.ok) { alert('Error: ' + (data.detail || 'desconocido')); }
  await loadUsers();
}

async function toggleActivoUsuario(userId, nuevoEstado) {
  var params = new URLSearchParams({ activo: nuevoEstado });
  var res = await fetch('/admin/users/' + userId + '/activo?' + params.toString(), { method: 'PATCH', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (!data.ok) { alert('Error: ' + (data.detail || 'desconocido')); }
  await loadUsers();
}

async function resetPasswordUsuario(userId) {
  var newPass = prompt('Nueva contrasena (min. 6 caracteres):');
  if (!newPass) return;
  if (newPass.length < 6) { alert('La contrasena debe tener al menos 6 caracteres'); return; }
  var params = new URLSearchParams({ password: newPass });
  var res = await fetch('/admin/users/' + userId + '/password?' + params.toString(), { method: 'PATCH', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { alert('Contrasena actualizada'); } else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function eliminarUsuarioAdmin(userId) {
  if (!confirm('Eliminar este usuario? Esta accion no se puede deshacer.')) return;
  var res = await fetch('/admin/users/' + userId, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await loadUsers(); } else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function editarNombreUsuario(userId, nombreActual, apellidoActual) {
  var nombre = prompt('Nombre:', nombreActual || '');
  if (nombre === null) return;
  var apellido = prompt('Apellido:', apellidoActual || '');
  if (apellido === null) return;
  var params = new URLSearchParams({ nombre: nombre, apellido: apellido });
  var res = await fetch('/admin/users/' + userId + '/nombre?' + params.toString(), { method: 'PATCH', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await loadUsers(); } else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// ========================= AUDIT LOG =========================
let _auditOffset = 0;
const _auditLimit = 50;

async function loadAuditLog(offset) {
  if (offset !== undefined) _auditOffset = offset;
  const usuario = document.getElementById('auditFiltroUsuario').value.trim();
  const accion = document.getElementById('auditFiltroAccion').value;
  const entidad = document.getElementById('auditFiltroEntidad').value;

  const params = new URLSearchParams({ limit: _auditLimit, offset: _auditOffset });
  if (usuario) params.append('usuario', usuario);
  if (accion) params.append('accion', accion);
  if (entidad) params.append('entidad', entidad);

  const data = await apiGet('/admin/audit?' + params.toString());
  if (!data) return;

  // Populate filter dropdowns (only if empty)
  const accSel = document.getElementById('auditFiltroAccion');
  if (accSel.options.length <= 1 && data.acciones_disponibles) {
    data.acciones_disponibles.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      accSel.appendChild(opt);
    });
  }
  const entSel = document.getElementById('auditFiltroEntidad');
  if (entSel.options.length <= 1 && data.entidades_disponibles) {
    data.entidades_disponibles.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e; opt.textContent = e;
      entSel.appendChild(opt);
    });
  }

  const container = document.getElementById('auditLogContainer');
  if (!data.logs || data.logs.length === 0) {
    container.innerHTML = '<div class="muted">No hay registros de auditor\u00eda</div>';
    document.getElementById('auditPagination').innerHTML = '';
    return;
  }

  const accionColors = {
    login: '#2196F3', signup: '#2196F3', registrar_usuario: '#9C27B0',
    importar_csv: '#8BC34A', exportar_excel: '#FF9800',
    crear_proyecto: '#4CAF50', editar_proyecto: '#FFC107', eliminar_proyecto: '#F44336',
    mover_barras: '#00BCD4', reset_db: '#F44336',
    crear_cliente: '#4CAF50', editar_cliente: '#FFC107', desactivar_cliente: '#F44336',
    asignar_cliente: '#9C27B0',
  };

  container.innerHTML = '<table style="width:100%; font-size:11px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:5px 6px;">Fecha</th>' +
    '<th style="padding:5px 6px;">Usuario</th>' +
    '<th style="padding:5px 6px;">Acci\u00f3n</th>' +
    '<th style="padding:5px 6px;">Detalle</th>' +
    '<th style="padding:5px 6px;">Entidad</th>' +
    '<th style="padding:5px 6px;">ID</th>' +
    '</tr>' +
    data.logs.map(l => {
      const fecha = l.fecha ? l.fecha.replace('T', ' ').substring(0, 19) : '';
      const color = accionColors[l.accion] || '#666';
      return '<tr style="border-bottom:1px solid #f0f0f0;">' +
        '<td style="padding:4px 6px; white-space:nowrap;" class="muted">' + fecha + '</td>' +
        '<td style="padding:4px 6px;">' + l.usuario + '</td>' +
        '<td style="padding:4px 6px;"><span style="background:' + color + '; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px;">' + l.accion + '</span></td>' +
        '<td style="padding:4px 6px; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + (l.detalle || '').replace(/"/g, '&quot;') + '">' + (l.detalle || '-') + '</td>' +
        '<td style="padding:4px 6px;" class="muted">' + (l.entidad || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:10px;" class="muted">' + (l.entidad_id || '-') + '</td>' +
        '</tr>';
    }).join('') +
    '</table>';

  // Pagination
  const pag = document.getElementById('auditPagination');
  const totalPages = Math.ceil(data.total / _auditLimit);
  const currentPage = Math.floor(_auditOffset / _auditLimit) + 1;
  let pagHtml = '<span class="muted" style="font-size:11px;">' + data.total + ' registros \u2014 P\u00e1gina ' + currentPage + ' de ' + totalPages + '</span>';
  if (_auditOffset > 0) {
    pagHtml += ' <button class="secondary" style="font-size:11px; padding:2px 8px;" onclick="loadAuditLog(' + (_auditOffset - _auditLimit) + ')">← Anterior</button>';
  }
  if (_auditOffset + _auditLimit < data.total) {
    pagHtml += ' <button class="secondary" style="font-size:11px; padding:2px 8px;" onclick="loadAuditLog(' + (_auditOffset + _auditLimit) + ')">Siguiente →</button>';
  }
  pag.innerHTML = pagHtml;
}

// ========================= RECLAMOS =========================
// Delegado a features/reclamos/index.js (E.1.6)

// ========================= LANDING INDICADORES =========================
// Delegado a features/portal/index.js (E.3)

// Prevent browser from opening files dropped outside the drop zone
document.addEventListener('dragover', function(e) { e.preventDefault(); });
document.addEventListener('drop', function(e) { e.preventDefault(); });

// Block all paste events to prevent image duplication
document.addEventListener('paste', function(e) {
  // Check if clipboard contains images
  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return; // Block image paste completely
    }
  }
}, true);

(async function init() {
  if (!ensureAuthenticatedSession()) return;
  await loadMe();
  
  // Restore tab from hash
  var hash = window.location.hash.substring(1); // Remove #
  if (hash === 'dashboards' || hash === 'presentaciones') {
    await waitForReclamosFeatureReady();
    if (typeof window.switchRecTab === 'function') {
      window.switchRecTab(hash);
    }
  }
})();
