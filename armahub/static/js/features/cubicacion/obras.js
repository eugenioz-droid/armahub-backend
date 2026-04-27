// ========================= CUBICACIÓN — Obras (E.4) =========================
// Gestión de proyectos: listado, CRUD, tree nav, cargas por proyecto, autorizados.

// Store proyectos data globally for filtering
var _proyectosData = [];
var _proyectosSoloConDatos = false;

function _toNumber(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _proyectoTieneDatos(p) {
  if (!p) return false;
  return _toNumber(p.total_kilos) > 0 ||
         _toNumber(p.total_barras) > 0 ||
         _toNumber(p.diam_prom) > 0 ||
         _toNumber(p.ppi) > 0;
}

function _applyProyectoFilters() {
  var search = (document.getElementById('proyectoSearchInput')?.value || '').toLowerCase().trim();
  var filtered = (_proyectosData || []).filter(function(p) {
    if (_proyectosSoloConDatos && !_proyectoTieneDatos(p)) return false;
    if (!search) return true;
    return (p.nombre_proyecto || '').toLowerCase().includes(search) ||
           (p.cubicador || '').toLowerCase().includes(search) ||
           String(p.id_proyecto || '').toLowerCase().includes(search);
  });
  renderProyectosTable(filtered);
}

async function loadProyectos() {
  const data = await apiGet('/proyectos');
  if (!data) return;
  
  _proyectosData = data.proyectos || [];
  _applyProyectoFilters();

  // Populate export project filter
  const epf = document.getElementById('exportProyecto');
  if (epf) {
    const prevE = epf.value;
    epf.innerHTML = '<option value="">-- Selecciona proyecto --</option>' +
      data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
    if (prevE) epf.value = prevE;
  }

  // Populate sector constructivo project filter
  const spf = document.getElementById('sectorProyectoFilter');
  if (spf) {
    const prev = spf.value;
    spf.innerHTML = '<option value="">Todos los proyectos</option>' +
      data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
    if (prev) spf.value = prev;
  }

  // Populate matriz constructiva project filter
  const mpf = document.getElementById('matrizProyectoFilter');
  if (mpf) {
    const prevM = mpf.value;
    mpf.innerHTML = '<option value="">— Selecciona un proyecto —</option>' +
      data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
    if (prevM) mpf.value = prevM;
  }

  // Populate navegador sectores project filter
  const npf = document.getElementById('navProyectoFilter');
  if (npf) {
    const prevN = npf.value;
    npf.innerHTML = '<option value="">— Selecciona proyecto —</option>' +
      data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
    if (prevN) npf.value = prevN;
  }

  // Populate pedidos project filter
  const ppf = document.getElementById('pedidoProyecto');
  if (ppf) {
    const prevP = ppf.value;
    ppf.innerHTML = '<option value="">— Selecciona proyecto —</option>' +
      data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
    if (prevP) ppf.value = prevP;
  }

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
  _applyProyectoFilters();
}

function toggleProyectosConDatos() {
  _proyectosSoloConDatos = !_proyectosSoloConDatos;
  var btn = document.getElementById('proyectosConDatosToggle');
  if (btn) {
    if (_proyectosSoloConDatos) {
      btn.textContent = 'Con datos';
      btn.style.background = '#2e7d32';
      btn.style.color = '#fff';
      btn.style.borderColor = '#2e7d32';
    } else {
      btn.textContent = 'Todos';
      btn.style.background = '#fff';
      btn.style.color = '#2e7d32';
      btn.style.borderColor = '#2e7d32';
    }
  }
  _applyProyectoFilters();
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
  html += '<th style="padding:8px 6px; text-align:left; border-bottom:2px solid #ddd;">Proyecto</th>';
  html += '<th style="padding:8px 6px; text-align:left; border-bottom:2px solid #ddd;">Cubicador</th>';
  html += '<th style="padding:8px 6px; text-align:right; border-bottom:2px solid #ddd;">Kilos</th>';
  html += '<th style="padding:8px 6px; text-align:right; border-bottom:2px solid #ddd;">Ø</th>';
  html += '<th style="padding:8px 6px; text-align:right; border-bottom:2px solid #ddd;">PPI</th>';
  html += '</tr></thead><tbody>';
  
  years.forEach(function(year) {
    // Year header row
    html += '<tr style="background:#e8f5e9;">';
    html += '<td colspan="5" style="padding:6px 8px; font-weight:bold; color:#2e7d32; font-size:13px;">📅 ' + year + '</td>';
    html += '</tr>';
    
    byYear[year].forEach(function(p) {
      var kilosStr = formatInteger(p.total_kilos, '0');
      var diamStr = p.diam_prom ? formatDecimal(p.diam_prom, 1, '-') : '-';
      var ppiStr = p.ppi ? formatDecimal(p.ppi, 1, '-') : '-';
      
      html += '<tr class="proyecto-row" data-id="' + p.id_proyecto + '" style="border-bottom:1px solid #eee; cursor:pointer;" onclick="openObraDetailModal(\'' + p.id_proyecto.replace(/'/g, "\\'") + '\')">';
      html += '<td style="padding:6px;"><strong>' + (p.nombre_proyecto || p.id_proyecto) + '</strong></td>';
      html += '<td style="padding:6px; color:#666;">' + (p.cubicador || '-') + '</td>';
      html += '<td style="padding:6px; text-align:right; font-weight:500;">' + kilosStr + ' kg</td>';
      html += '<td style="padding:6px; text-align:right; color:#666;">' + diamStr + '</td>';
      html += '<td style="padding:6px; text-align:right; color:#666;">' + ppiStr + '</td>';
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
  switchTab('buscar');
  setTimeout(async function() {
    var projSel = document.getElementById('proyecto');
    if (projSel) projSel.value = idProyecto;
    // Load dependent filters for the selected project, then set sub-filters
    if (typeof loadFilters === 'function') {
      await loadFilters({ proyecto: idProyecto });
    }
    var secSel = document.getElementById('sector');
    if (secSel && sector) secSel.value = sector;
    var pisoSel = document.getElementById('piso');
    if (pisoSel && piso) pisoSel.value = piso;
    var cicloSel = document.getElementById('ciclo');
    if (cicloSel && ciclo) cicloSel.value = ciclo;
    if (typeof buscar === 'function') buscar(true);
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

async function openObraDetailModal(idProyecto) {
  showModal('obraDetailModal');
  var p = _proyectosData.find(function(x) { return x.id_proyecto === idProyecto; });
  if (!p) { closeObraDetailModal(); showToast('Proyecto no encontrado', 'error'); return; }

  document.getElementById('obraDetailTitle').textContent = '🏗️ ' + (p.nombre_proyecto || idProyecto);
  document.getElementById('obraDetailEditBtn').onclick = function() { closeObraDetailModal(); openEditObraModal(idProyecto); };

  // Delete button: visible for admin/admin2, or cubicador with 0 barras
  var delBtn = document.getElementById('obraDetailDeleteBtn');
  var canDelete = currentRole === 'admin' || currentRole === 'admin2' || (currentRole === 'cubicador' && (p.total_barras || 0) === 0);
  delBtn.style.display = canDelete ? '' : 'none';
  delBtn.onclick = function() { eliminarObra(idProyecto, p.nombre_proyecto, p.total_barras || 0); };

  // Reset sections
  document.getElementById('obraDetailSidebar').innerHTML = '<div class="muted">Cargando...</div>';
  document.getElementById('obraDetailMatriz').innerHTML = '<div class="muted">Cargando matriz...</div>';
  document.getElementById('obraDetailTree').innerHTML = '<div class="muted">Cargando...</div>';
  document.getElementById('obraDetailTree').style.display = 'none';
  document.getElementById('obraDetailTreeArrow').textContent = '▸';
  document.getElementById('obraDetailCargas').innerHTML = '<div class="muted">Cargando...</div>';

  // Reset cobertura state
  _obraCoberturaCargada = false;
  var _coberturaSec = document.getElementById('obraCoberturaSection');
  if (_coberturaSec) {
    _coberturaSec.style.display = 'none';
    document.getElementById('obraCoberturaArrow').textContent = '▸';
    document.getElementById('obraCoberturaMatrix').innerHTML = '<div class="muted" style="font-size:12px;">Cargando...</div>';
  }

  // Store current id for sub-actions
  window._obraDetailCurrentId = idProyecto;

  // Load sidebar immediately from cache
  renderObraDetailSidebar(p);

  // Load matrix, tree data, autorizados and cargas in parallel
  var matrizPromise = apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(idProyecto));
  var treePromise = apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/sectores-nav');
  var authPromise = apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizados');
  var cargasPromise = apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/cargas?limit=500');

  var results = await Promise.all([matrizPromise, treePromise, authPromise, cargasPromise]);
  var matrizData = results[0];
  var treeData = results[1];
  var authData = results[2];
  var cargasData = results[3];

  // Update sidebar with autorizados
  renderObraDetailSidebar(p, authData);

  // Render matrix
  if (matrizData && matrizData.items && matrizData.items.length > 0) {
    await buildObraDetailMatriz(matrizData.items, idProyecto);
  } else {
    document.getElementById('obraDetailMatriz').innerHTML = '<div class="muted">Sin datos para generar matriz</div>';
  }

  // Prepare tree data (render on expand)
  window._obraDetailTreeData = treeData;
  if (treeData && treeData.pisos && treeData.pisos.length > 0) {
    document.getElementById('obraDetailTree').innerHTML = '';
    renderObraDetailTree(document.getElementById('obraDetailTree'), treeData.pisos, idProyecto);
  } else {
    document.getElementById('obraDetailTree').innerHTML = '<div class="muted">Sin estructura cargada</div>';
  }

  // Render cargas
  renderObraDetailCargas(cargasData, idProyecto);
}

function closeObraDetailModal() {
  hideModal('obraDetailModal');
  window._obraDetailCurrentId = null;
}

function renderObraDetailSidebar(p, authData) {
  var html = '';
  // KPIs grid
  html += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:14px;">';
  html += '<div style="background:#f8f9fa; padding:8px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:18px; font-weight:bold; color:#8BC34A;">' + formatInteger(p.total_kilos, '0') + '</div>';
  html += '<div style="font-size:10px; color:#666;">kg</div></div>';
  html += '<div style="background:#f8f9fa; padding:8px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:18px; font-weight:bold; color:#558B2F;">' + (p.total_barras || 0).toLocaleString() + '</div>';
  html += '<div style="font-size:10px; color:#666;">barras</div></div>';
  html += '<div style="background:#f8f9fa; padding:8px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:14px; font-weight:bold; color:#666;">' + (p.diam_prom ? formatDecimal(p.diam_prom, 1, '-') : '-') + '</div>';
  html += '<div style="font-size:10px; color:#666;">Ø mm</div></div>';
  html += '<div style="background:#f8f9fa; padding:8px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:14px; font-weight:bold; color:#666;">' + (p.ppi ? formatDecimal(p.ppi, 1, '-') : '-') + '</div>';
  html += '<div style="font-size:10px; color:#666;">PPI</div></div>';
  html += '</div>';

  // Metadata
  html += '<div style="font-size:12px; line-height:1.8; color:#444;">';
  html += '<div><strong>ID:</strong> <span style="font-size:10px; color:#888;">' + p.id_proyecto + '</span></div>';
  html += '<div><strong>Creado:</strong> ' + formatDateShort(p.fecha_creacion, '-') + '</div>';
  html += '<div><strong>Inicio:</strong> ' + formatDateShort(p.fecha_inicio, '-') + '</div>';
  html += '<div><strong>Creador:</strong> ' + (p.usuario_creador || '-') + '</div>';
  html += '<div><strong>Calculista:</strong> ' + (p.calculista_nombre || '-') + '</div>';
  html += '<div><strong>Constructora:</strong> ' + (p.constructora_nombre || '-') + '</div>';
  html += '</div>';

  // Autorizados
  if (authData && authData.autorizados) {
    html += '<div style="margin-top:12px; font-size:12px;"><strong>👥 Autorizados</strong></div>';
    if (authData.autorizados.length === 0) {
      html += '<div class="muted" style="font-size:11px;">Sin usuarios adicionales</div>';
    } else {
      html += '<div style="margin-top:4px;">';
      var rolColors = {admin:'#1565C0', usc:'#FF9800', cubicador:'#8BC34A', externo:'#9C27B0', cliente:'#607D8B'};
      authData.autorizados.forEach(function(a) {
        var rc = rolColors[a.rol] || '#666';
        var display = a.nombre ? a.nombre : a.email;
        html += '<div style="font-size:11px; padding:1px 0;"><span style="font-size:9px; padding:1px 4px; border-radius:2px; background:' + rc + '22; color:' + rc + '; font-weight:600;">' + a.rol.toUpperCase() + '</span> ' + display + '</div>';
      });
      html += '</div>';
    }
  }

  // Aliases
  if (p.aliases && p.aliases.length > 0) {
    html += '<div style="margin-top:12px; font-size:12px;"><strong>📎 Aliases</strong></div>';
    html += '<div style="margin-top:2px;">' + p.aliases.map(function(a) { return '<span style="font-size:10px; background:#e8f5e9; padding:1px 6px; border-radius:3px; margin:1px;">' + a + '</span>'; }).join(' ') + '</div>';
  }

  document.getElementById('obraDetailSidebar').innerHTML = html;
}

async function buildObraDetailMatriz(items, idProyecto) {
  var container = document.getElementById('obraDetailMatriz');

  // Fetch export history for state colors
  var exportHistory = {};
  try {
    var histData = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/export-history');
    if (histData && histData.history) exportHistory = histData.history;
  } catch(e) { /* ignore — just no colors */ }

  // Build lookup
  var lookup = {};
  items.forEach(function(i) {
    var s = (i.sector || '?').toUpperCase().trim();
    var p = (i.piso || '?').trim();
    var c = (i.ciclo || '?').trim();
    lookup[s + '|' + p + '|' + c] = { barras: i.barras, kilos: i.kilos };
  });

  var pisosSet = new Set(), ciclosSet = new Set(), sectoresSet = new Set();
  items.forEach(function(i) {
    pisosSet.add((i.piso || '?').trim());
    ciclosSet.add((i.ciclo || '?').trim());
    sectoresSet.add((i.sector || '?').toUpperCase().trim());
  });

  var pisos = Array.from(pisosSet).sort(function(a, b) { return pisoOrder(a) - pisoOrder(b); });
  pisos.reverse();

  var ciclos = Array.from(ciclosSet).sort(function(a, b) {
    var na = parseInt((a.match(/(\d+)/) || [0,0])[1]);
    var nb = parseInt((b.match(/(\d+)/) || [0,0])[1]);
    return na - nb;
  });

  var TYPE_ORDER = ['FUND', 'LCIELO', 'VCIELO', 'ELEV'];
  var TYPE_INITIALS = { 'FUND': 'F', 'LCIELO': 'L', 'VCIELO': 'V', 'ELEV': 'E' };
  var lowestPiso = pisos[pisos.length - 1];

  function getTypesForPiso(piso) {
    var types = [];
    if (piso === lowestPiso) {
      for (var ci = 0; ci < ciclos.length; ci++) { if (lookup['FUND|' + piso + '|' + ciclos[ci]]) { types.push('FUND'); break; } }
    }
    for (var ti = 0; ti < TYPE_ORDER.length; ti++) {
      if (TYPE_ORDER[ti] === 'FUND') continue;
      for (var ci2 = 0; ci2 < ciclos.length; ci2++) { if (lookup[TYPE_ORDER[ti] + '|' + piso + '|' + ciclos[ci2]]) { types.push(TYPE_ORDER[ti]); break; } }
    }
    sectoresSet.forEach(function(s) {
      if (TYPE_ORDER.indexOf(s) >= 0) return;
      for (var ci3 = 0; ci3 < ciclos.length; ci3++) { if (lookup[s + '|' + piso + '|' + ciclos[ci3]]) { types.push(s); break; } }
    });
    return types.length > 0 ? types : ['ELEV'];
  }

  // Build table — same format as export matrix but without checkboxes
  var html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  html += '<thead><tr>';
  html += '<th style="border:1px solid #333; padding:3px 4px; background:#1a1a1a; color:#8BC34A; white-space:nowrap; min-width:120px; font-size:10px;">Piso</th>';
  ciclos.forEach(function(c) {
    html += '<th style="border:1px solid #333; padding:2px 4px; background:#1a1a1a; color:#8BC34A; text-align:center; white-space:nowrap; font-size:10px;">' + c + '</th>';
  });
  html += '</tr></thead><tbody>';

  pisos.forEach(function(piso) {
    var types = getTypesForPiso(piso);
    var pisoTotalKg = 0, pisoTotalBar = 0;
    var sectionTotals = {};
    types.forEach(function(tipo) {
      if (!sectionTotals[tipo]) sectionTotals[tipo] = { kg: 0, bar: 0 };
      ciclos.forEach(function(ciclo) {
        var d = lookup[tipo + '|' + piso + '|' + ciclo];
        if (d) {
          pisoTotalKg += d.kilos;
          pisoTotalBar += d.barras;
          sectionTotals[tipo].kg += d.kilos;
          sectionTotals[tipo].bar += d.barras;
        }
      });
    });

    types.forEach(function(tipo, typeIdx) {
      html += '<tr>';
      if (typeIdx === 0) {
        html += '<td rowspan="' + types.length + '" style="border:1px solid #ccc; padding:4px 5px; font-weight:bold; background:#f8f8f8; color:#1a1a1a; vertical-align:middle; white-space:nowrap; min-width:120px;">';
        html += '<div style="margin-bottom:3px;"><span style="font-size:11px; font-weight:700; line-height:1;">' + piso + ': ' + Math.round(pisoTotalKg).toLocaleString() + 'kg ' + pisoTotalBar + 'un</span></div>';
        if (types.length > 1 || types[0] !== 'ELEV') {
          html += '<div style="font-size:9px; color:#555; line-height:1.4;">';
          types.forEach(function(t) {
            var st = sectionTotals[t];
            var initial = TYPE_INITIALS[t] || t.charAt(0);
            html += '<div>' + initial + ': ' + Math.round(st.kg).toLocaleString() + 'kg ' + st.bar + 'un</div>';
          });
          html += '</div>';
        }
        html += '</td>';
      }
      ciclos.forEach(function(ciclo) {
        var lookupKey = tipo + '|' + piso + '|' + ciclo;
        var exportKey = tipo + '_' + piso + '_' + ciclo;
        var d = lookup[lookupKey];
        if (d) {
          // Export state colors (same as export matrix)
          var hist = exportHistory[exportKey];
          var isDone = !!hist;
          var isModified = false;
          if (isDone && hist.ultima_modificacion && hist.ultima_fecha) {
            isModified = hist.ultima_modificacion > hist.ultima_fecha;
          }
          var cellBg = '#fff';
          if (isDone && isModified) {
            cellBg = '#ffcdd2'; // rosado — modified after export
          } else if (isDone) {
            cellBg = '#e8f5e9'; // verde — exported, unchanged
          }
          var doneTitle = '';
          if (isDone) {
            doneTitle = ' | Exportado ' + hist.veces + 'x, último: ' + (hist.ultima_fecha || '').substring(0, 10);
            if (isModified) doneTitle += ' | ⚠️ MODIFICADO';
          }
          html += '<td style="border:1px solid #ccc; padding:2px 4px; background:' + cellBg + '; text-align:center; cursor:pointer; position:relative; min-width:80px; white-space:nowrap;" ';
          html += 'onclick="closeObraDetailModal(); goToBarManager(\'' + idProyecto.replace(/'/g, "\\'") + '\', \'' + tipo.replace(/'/g, "\\'") + '\', \'' + (piso || '').replace(/'/g, "\\'") + '\', \'' + (ciclo || '').replace(/'/g, "\\'") + '\')" ';
          html += 'title="' + tipo + ' ' + piso + ' ' + ciclo + ': ' + d.barras + ' barras, ' + Math.round(d.kilos).toLocaleString() + ' kg' + doneTitle + ' — click para ver barras">';
          if (isDone) {
            if (isModified) {
              html += '<span style="position:absolute; top:0px; right:2px; font-size:9px; color:#c62828;" title="Modificado después de exportar">&#9888;</span>';
            } else {
              html += '<span style="position:absolute; top:0px; right:2px; font-size:9px; color:#558B2F;" title="Exportado ' + hist.veces + ' vez(es)">&#10004;</span>';
            }
          }
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
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#e8f5e9; border:1px solid #8BC34A; vertical-align:middle;"></span> <span style="color:#558B2F;">&#10004;</span> Exportado</span>';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#ffcdd2; border:1px solid #e57373; vertical-align:middle;"></span> <span style="color:#c62828;">&#9888;</span> Modificado</span>';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#fff; border:1px solid #ccc; vertical-align:middle;"></span> Pendiente</span>';
  html += '</div>';

  container.innerHTML = html;
}

function toggleObraDetailTree() {
  var tree = document.getElementById('obraDetailTree');
  var arrow = document.getElementById('obraDetailTreeArrow');
  if (tree.style.display === 'none') {
    tree.style.display = '';
    arrow.textContent = '▾';
  } else {
    tree.style.display = 'none';
    arrow.textContent = '▸';
  }
}

function renderObraDetailTree(container, pisos, idProyecto) {
  if (!pisos || pisos.length === 0) { container.innerHTML = '<span class="muted">Sin datos</span>'; return; }
  var html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  html += '<thead><tr style="background:#f0f0f0;">';
  html += '<th style="padding:4px 6px; text-align:left;">Piso / Ciclo / Sector</th>';
  html += '<th style="padding:4px 6px; text-align:right;">Kilos</th>';
  html += '<th style="padding:4px 6px; text-align:right;">Barras</th>';
  html += '<th style="padding:4px 6px; text-align:center;">Ver</th>';
  html += '</tr></thead><tbody>';
  pisos.forEach(function(p) {
    var pisoId = ('odt_' + idProyecto + '_' + p.piso).replace(/[^a-zA-Z0-9_-]/g, '_');
    html += '<tr style="background:#e3f2fd; cursor:pointer;" onclick="toggleSectorPisos(\'' + pisoId + '\')">';
    html += '<td style="padding:4px 6px; font-weight:bold;"><span id="sarrow-' + pisoId + '">▸</span> ' + (p.piso || '?') + '</td>';
    html += '<td style="padding:4px 6px; text-align:right; font-weight:500;">' + Math.round(p.kilos).toLocaleString() + ' kg</td>';
    html += '<td style="padding:4px 6px; text-align:right;">' + p.barras + '</td>';
    html += '<td style="padding:4px 6px; text-align:center;"><button class="secondary" style="font-size:9px; padding:2px 5px;" onclick="event.stopPropagation(); closeObraDetailModal(); goToBarManager(\'' + idProyecto.replace(/'/g, "\\'") + '\', \'\', \'' + (p.piso || '').replace(/'/g, "\\'") + '\', \'\')">🔍</button></td>';
    html += '</tr>';
    html += '<tr id="pisos-' + pisoId + '" style="display:none;"><td colspan="4" style="padding:0;"><table style="width:100%; border-collapse:collapse;">';
    (p.ciclos || []).forEach(function(c) {
      var cicloId = pisoId + '_' + (c.ciclo || '').replace(/[^a-zA-Z0-9_-]/g, '_');
      html += '<tr style="background:#fff; cursor:pointer;" onclick="togglePisoCiclos(\'' + cicloId + '\')">';
      html += '<td style="padding:3px 6px 3px 20px;"><span id="parrow-' + cicloId + '">▸</span> ' + (c.ciclo || '?') + '</td>';
      html += '<td style="padding:3px 6px; text-align:right;">' + Math.round(c.kilos).toLocaleString() + ' kg</td>';
      html += '<td style="padding:3px 6px; text-align:right;">' + c.barras + '</td>';
      html += '<td style="padding:3px 6px; text-align:center;"><button class="secondary" style="font-size:9px; padding:2px 5px;" onclick="event.stopPropagation(); closeObraDetailModal(); goToBarManager(\'' + idProyecto.replace(/'/g, "\\'") + '\', \'\', \'' + (p.piso || '').replace(/'/g, "\\'") + '\', \'' + (c.ciclo || '').replace(/'/g, "\\'") + '\')">🔍</button></td>';
      html += '</tr>';
      html += '<tr id="ciclos-' + cicloId + '" style="display:none;"><td colspan="4" style="padding:0;"><table style="width:100%; border-collapse:collapse;">';
      (c.sectores || []).forEach(function(s) {
        html += '<tr style="background:#fafafa;">';
        html += '<td style="padding:2px 6px 2px 40px; color:#666;">' + (s.sector || '?') + '</td>';
        html += '<td style="padding:2px 6px; text-align:right; color:#666;">' + Math.round(s.kilos).toLocaleString() + ' kg</td>';
        html += '<td style="padding:2px 6px; text-align:right; color:#666;">' + s.barras + '</td>';
        html += '<td style="padding:2px 6px; text-align:center;"><button class="secondary" style="font-size:9px; padding:2px 5px;" onclick="closeObraDetailModal(); goToBarManager(\'' + idProyecto.replace(/'/g, "\\'") + '\', \'' + (s.sector || '').replace(/'/g, "\\'") + '\', \'' + (p.piso || '').replace(/'/g, "\\'") + '\', \'' + (c.ciclo || '').replace(/'/g, "\\'") + '\')">🔍</button></td>';
        html += '</tr>';
      });
      html += '</table></td></tr>';
    });
    html += '</table></td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderObraDetailCargas(data, idProyecto) {
  var container = document.getElementById('obraDetailCargas');
  if (!data || !data.cargas) { container.innerHTML = '<span class="muted">Error cargando cargas</span>'; return; }
  if (data.cargas.length === 0) { container.innerHTML = '<span class="muted">Sin cargas registradas</span>'; return; }
  var safeId = 'odm_' + idProyecto.replace(/[^a-zA-Z0-9_-]/g, '_');
  var html = '';
  html += '<div id="bulk-actions-' + safeId + '" style="display:none; margin-bottom:8px; padding:8px 10px; background:#fff3cd; border-radius:4px; font-size:12px;">';
  html += '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">';
  html += '<span><strong id="bulk-count-' + safeId + '">0</strong> carga(s) seleccionada(s)</span>';
  html += '<button style="background:#dc3545; color:white; border:none; padding:3px 10px; border-radius:3px; font-size:11px; cursor:pointer;" onclick="eliminarCargasSeleccionadasModal(\'' + idProyecto.replace(/'/g, "\\'") + '\')">🗑️ Eliminar</button>';
  html += '<span style="color:#999;">|</span>';
  html += '<select id="moverDestino-' + safeId + '" style="font-size:11px; padding:2px 6px;">';
  html += '<option value="">Mover a...</option>';
  _proyectosData.forEach(function(pr) {
    if (pr.id_proyecto !== idProyecto) {
      html += '<option value="' + pr.id_proyecto + '">' + (pr.nombre_proyecto || pr.id_proyecto) + '</option>';
    }
  });
  html += '</select>';
  html += '<button class="secondary" style="font-size:11px; padding:3px 10px;" onclick="moverCargasSeleccionadasModal(\'' + idProyecto.replace(/'/g, "\\'") + '\', \'' + safeId + '\')">📦 Mover</button>';
  html += '</div></div>';
  html += '<div style="max-height:250px; overflow-y:auto; border:1px solid #eee; border-radius:4px;">';
  html += '<table style="width:100%; font-size:11px; border-collapse:collapse;">';
  html += '<thead style="position:sticky; top:0; background:#f8f8f8; z-index:1;"><tr>';
  html += '<th style="width:28px; padding:4px;"><input type="checkbox" id="selectAll-' + safeId + '" onchange="toggleAllCargasProyecto(\'' + safeId + '\')" style="cursor:pointer;" title="Seleccionar todas"></th>';
  html += '<th style="padding:4px;">Archivo</th><th style="padding:4px;">Plano</th><th style="padding:4px; text-align:right;">Barras</th><th style="padding:4px; text-align:right;">Kilos</th><th style="padding:4px;">Versión</th><th style="padding:4px;">Usuario</th><th style="padding:4px;">Fecha</th>';
  html += '</tr></thead><tbody>';
  data.cargas.forEach(function(c) {
    var fecha = '';
    if (c.fecha) {
      var d = new Date(c.fecha);
      fecha = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
    }
    var estadoBadge = '';
    var rowBg = '';
    if (c.estado === 'parcial') {
      estadoBadge = '<span style="background:#fff3cd; color:#856404; padding:1px 5px; border-radius:3px; font-size:9px; font-weight:600;" title="' + (c.errores || '').replace(/"/g, '&quot;') + '">⚠ PARCIAL</span> ';
      rowBg = ' style="background:#fffde7;"';
    } else if (c.estado === 'error') {
      estadoBadge = '<span style="background:#ffcdd2; color:#b42318; padding:1px 5px; border-radius:3px; font-size:9px; font-weight:600;">✕ ERROR</span> ';
      rowBg = ' style="background:#fff5f5;"';
    }
    html += '<tr' + rowBg + '>';
    html += '<td style="padding:3px;"><input type="checkbox" class="carga-cb-' + safeId + '" data-id="' + c.id + '" onchange="updateCargasSelectionProyecto(\'' + safeId + '\')"></td>';
    html += '<td style="padding:3px;">' + estadoBadge + (c.archivo || '-') + '</td>';
    html += '<td style="padding:3px;">' + (c.plano_code || '-') + '</td>';
    html += '<td style="padding:3px; text-align:right;">' + c.barras_count + '</td>';
    html += '<td style="padding:3px; text-align:right;">' + Math.round(c.kilos || 0).toLocaleString() + ' kg</td>';
    html += '<td style="padding:3px;">' + (c.version_archivo || '-') + '</td>';
    html += '<td style="padding:3px; color:#888;">' + (c.usuario || '-') + '</td>';
    html += '<td style="padding:3px; color:#888;">' + fecha + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  html += '<div class="muted" style="font-size:10px; margin-top:4px;">' + data.cargas.length + ' carga(s) en total</div>';
  container.innerHTML = html;
}

async function eliminarCargasSeleccionadasModal(idProyecto) {
  var safeId = 'odm_' + idProyecto.replace(/[^a-zA-Z0-9_-]/g, '_');
  var checkboxes = document.querySelectorAll('.carga-cb-' + safeId + ':checked');
  if (checkboxes.length === 0) return;
  var ids = Array.from(checkboxes).map(function(cb) { return parseInt(cb.dataset.id); });
  if (!confirm('¿Eliminar ' + ids.length + ' carga(s) seleccionada(s)?\n\nEsta acción no se puede deshacer.')) return;
  var res = await apiPostJson('/cargas/bulk-delete', { ids: ids });
  if (res && res.ok) {
    showToast('Eliminadas ' + res.cargas_eliminadas + ' carga(s) con ' + res.barras_eliminadas + ' barras', 'success');
    closeObraDetailModal();
    await loadProyectos();
    await loadInicio();
    await loadMiActividad();
  } else {
    showToast('Error: ' + (res?.detail || 'desconocido'), 'error');
  }
}

async function moverCargasSeleccionadasModal(idProyecto, safeId) {
  var checkboxes = document.querySelectorAll('.carga-cb-' + safeId + ':checked');
  if (checkboxes.length === 0) { showToast('Selecciona al menos una carga', 'error'); return; }
  var destSel = document.getElementById('moverDestino-' + safeId);
  var destino = destSel ? destSel.value : '';
  if (!destino) { showToast('Selecciona la obra destino', 'error'); return; }
  var destName = destSel.options[destSel.selectedIndex].text;
  var ids = Array.from(checkboxes).map(function(cb) { return parseInt(cb.dataset.id); });
  if (!confirm('¿Mover ' + ids.length + ' carga(s) a "' + destName + '"?\n\nLas barras asociadas también se moverán.')) return;
  var res = await apiPostJson('/cargas/mover', { ids: ids, destino: destino });
  if (res && res.ok) {
    showToast('Movidas ' + res.cargas_movidas + ' carga(s) con ' + res.barras_movidas + ' barras a ' + res.destino_nombre, 'success');
    closeObraDetailModal();
    await loadProyectos();
    await loadInicio();
    await loadMiActividad();
  } else {
    showToast('Error: ' + (res?.detail || 'desconocido'), 'error');
  }
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
  // Solo admin/admin2 pueden eliminar obras con data
  if (currentRole !== 'admin' && currentRole !== 'admin2' && barrasCount > 0) {
    showToast('No puedes eliminar una obra con ' + barrasCount + ' barras cargadas. Contacta al administrador.', 'error');
    return;
  }
  var msg;
  if (barrasCount > 0) {
    msg = '⚠️ ATENCIÓN: Se eliminarán ' + barrasCount + ' barras asociadas a "' + nombre + '".\n\nEsta acción es IRREVERSIBLE y eliminará toda la data del proyecto.';
  } else {
    msg = 'Se eliminará la obra "' + nombre + '" (sin barras). Esta acción no se puede deshacer.';
  }
  if (!confirm(msg)) return;
  if (barrasCount > 0) {
    var confirmText = prompt('Esta obra tiene ' + barrasCount + ' barras. Escribe ELIMINAR para confirmar:');
    if (confirmText !== 'ELIMINAR') { showToast('Eliminación cancelada', 'warning'); return; }
  }
  closeObraDetailModal();
  var res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(id)), {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    showToast('Obra "' + nombre + '" eliminada correctamente' + (data.barras_eliminadas ? ' (' + data.barras_eliminadas + ' barras)' : ''), 'success');
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    await loadDashboard('sector');
    await loadSectores();
  } else {
    showToast('Error: ' + (data.detail || 'desconocido'), 'error');
  }
}

async function moverBarras() {
  alert('Mover barras entre proyectos ya no está disponible.');
}

// ========================= MATRIZ DE COBERTURA POR CICLO =========================

var _obraCoberturaCargada = false;

var _SECTOR_LABELS = {
  LCIELO: { label: 'LCIELO', desc: 'Losa cielo', color: '#1976d2', unit: 'losas' },
  VCIELO: { label: 'VCIELO', desc: 'Viga cielo', color: '#7b1fa2', unit: 'ejes' },
  ELEV:   { label: 'ELEV',   desc: 'Elevación', color: '#e65100', unit: 'ejes' },
  FUND:   { label: 'FUND',   desc: 'Fundación', color: '#2e7d32', unit: 'ejes' }
};

function toggleObraCobertura() {
  var sec = document.getElementById('obraCoberturaSection');
  var arrow = document.getElementById('obraCoberturaArrow');
  if (!sec) return;
  if (sec.style.display === 'none') {
    sec.style.display = '';
    arrow.textContent = '▾';
    if (!_obraCoberturaCargada) {
      _obraCoberturaCargada = true;
      loadObraCobertura(window._obraDetailCurrentId);
    }
  } else {
    sec.style.display = 'none';
    arrow.textContent = '▸';
  }
}

function _escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadObraCobertura(idProyecto) {
  var container = document.getElementById('obraCoberturaMatrix');
  if (!container || !idProyecto) return;
  var data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/cobertura-ciclos');
  if (!data) {
    container.innerHTML = '<span class="muted" style="font-size:12px;">Error cargando matriz.</span>';
    return;
  }
  var ciclos = data.ciclos || [];
  var sectores = data.sectores || ['LCIELO', 'VCIELO', 'ELEV', 'FUND'];
  if (ciclos.length === 0) {
    container.innerHTML = '<span class="muted" style="font-size:12px;">Sin datos de cobertura.</span>';
    return;
  }

  var html = '<table style="width:100%; border-collapse:collapse; font-size:12px; background:#fff;">';
  html += '<thead><tr style="background:#ffe0b2; color:#5d4037;">';
  html += '<th style="padding:6px 8px; text-align:left; width:90px; border:1px solid #ffcc80;">Ciclo</th>';
  html += '<th style="padding:6px 8px; text-align:left; width:90px; border:1px solid #ffcc80;">Sector</th>';
  html += '<th style="padding:6px 8px; text-align:left; border:1px solid #ffcc80;">Ejes</th>';
  html += '<th style="padding:6px 8px; text-align:right; width:80px; border:1px solid #ffcc80;">Total</th>';
  html += '</tr></thead><tbody>';

  ciclos.forEach(function(c, ci) {
    var ciclo = c.ciclo;
    var sectoresData = c.sectores || {};
    sectores.forEach(function(s, si) {
      var meta = _SECTOR_LABELS[s] || { label: s, desc: '', color: '#555', unit: '' };
      var info = sectoresData[s] || { ejes: [], count: 0 };
      var ejesStr = (info.ejes && info.ejes.length)
        ? info.ejes.map(_escapeHtml).join(', ')
        : '<span style="color:#bbb;">—</span>';
      html += '<tr style="border-bottom:1px solid #f5f5f5;">';
      if (si === 0) {
        html += '<td rowspan="' + sectores.length + '" style="padding:6px 8px; vertical-align:top; font-weight:700; color:#e65100; background:#fff8e1; border:1px solid #ffe0b2;">' + _escapeHtml(ciclo) + '</td>';
      }
      html += '<td style="padding:5px 8px; border:1px solid #f5f5f5;">';
      html += '<span style="display:inline-block; padding:2px 8px; background:' + meta.color + '; color:#fff; border-radius:10px; font-size:11px; font-weight:600;" title="' + _escapeHtml(meta.desc) + '">' + _escapeHtml(meta.label) + '</span>';
      html += '</td>';
      html += '<td style="padding:5px 8px; color:#444; border:1px solid #f5f5f5;">' + ejesStr + '</td>';
      var totalTxt = info.count > 0
        ? ('<strong>' + info.count + '</strong> <span style="color:#888; font-size:11px;">' + meta.unit + '</span>')
        : '<span style="color:#bbb;">0</span>';
      html += '<td style="padding:5px 8px; text-align:right; border:1px solid #f5f5f5;">' + totalTxt + '</td>';
      html += '</tr>';
    });
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

