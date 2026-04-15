// ========================= CUBICACIÓN — Obras (E.4) =========================
// Gestión de proyectos: listado, CRUD, tree nav, cargas por proyecto, autorizados.

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
  mpf.innerHTML = '<option value="">— Selecciona un proyecto —</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prevM) mpf.value = prevM;

  // Populate navegador sectores project filter
  const npf = document.getElementById('navProyectoFilter');
  const prevN = npf.value;
  npf.innerHTML = '<option value="">— Selecciona proyecto —</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prevN) npf.value = prevN;

  // Populate pedidos project filter
  const ppf = document.getElementById('pedidoProyecto');
  const prevP = ppf.value;
  ppf.innerHTML = '<option value="">— Selecciona proyecto —</option>' +
    data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prevP) ppf.value = prevP;

  // Populate reclamos project filter
  const rpf = document.getElementById('recProyecto');
  if (rpf) {
    const prevR = rpf.value;
    rpf.innerHTML = '<option value="">— Sin proyecto —</option>' +
      data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
    if (prevR) rpf.value = prevR;
  }

  // Populate obra destino selector (import flow)
  if (typeof populateObraDestino === 'function') populateObraDestino();

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
  const res = await fetch(apiUrl('/proyectos'), {
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
    // Auto-seleccionar la obra recién creada en el selector destino
    var obraSel = document.getElementById('obraDestinoSelect');
    if (obraSel && data.id_proyecto) { obraSel.value = data.id_proyecto; onObraDestinoChange(); }
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
  var res = await fetch(apiUrl('/calculistas'), {
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
  var res = await fetch(apiUrl('/constructoras'), {
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
  const res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar'), {
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
  const res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar/' + userId), {
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
  var res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(id)), {
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
  var res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(id) + '/autorizar'), {
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
  if (!id || !confirm('¿Revocar acceso de este usuario?')) return;
  var res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(id) + '/autorizar/' + userId), {
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
  var res = await fetch(apiUrl('/calculistas'), {
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
  var res = await fetch(apiUrl('/constructoras'), {
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
  const res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(id)), {
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
