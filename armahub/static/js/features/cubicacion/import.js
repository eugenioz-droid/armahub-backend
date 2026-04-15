// ========================= CUBICACIÓN — Multi-File Import + Cargas Recientes (E.4) =========================
let pendingFiles = [];

// ========================= SELECTOR DE OBRA DESTINO =========================

function populateObraDestino() {
  const sel = document.getElementById('obraDestinoSelect');
  if (!sel) return;
  const prev = sel.value;
  const proyectos = window._proyectosData || [];
  sel.innerHTML = '<option value="">— Selecciona la obra —</option>' +
    proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  if (prev) sel.value = prev;
  onObraDestinoChange();
}

function onObraDestinoChange() {
  const sel = document.getElementById('obraDestinoSelect');
  const dropZone = document.getElementById('dropZone');
  const info = document.getElementById('obraDestinoInfo');
  if (!sel || !dropZone) return;
  const selected = sel.value;
  if (selected) {
    // Habilitar drop zone
    dropZone.style.border = '2px dashed #8BC34A';
    dropZone.style.background = '#f9fff4';
    dropZone.style.cursor = 'pointer';
    dropZone.style.opacity = '1';
    dropZone.style.pointerEvents = 'auto';
    dropZone.ondragover = function(e) { e.preventDefault(); this.style.background='#e8f5e9'; this.style.borderColor='#558B2F'; };
    dropZone.ondragleave = function() { this.style.background='#f9fff4'; this.style.borderColor='#8BC34A'; };
    dropZone.ondrop = function(e) { handleDrop(e); };
    dropZone.onclick = function() { document.getElementById('csvFile').click(); };
    dropZone.querySelector('div:nth-child(2)').textContent = 'Arrastra archivos CSV aquí o haz clic para seleccionar';
    dropZone.querySelector('div:nth-child(2)').style.color = '#2C2C2C';
    if (info) {
      const p = (window._proyectosData || []).find(p => p.id_proyecto === selected);
      info.textContent = p ? `Todos los archivos se cargarán en: ${p.nombre_proyecto}` : '';
    }
  } else {
    // Deshabilitar drop zone
    dropZone.style.border = '2px dashed #ccc';
    dropZone.style.background = '#f5f5f5';
    dropZone.style.cursor = 'not-allowed';
    dropZone.style.opacity = '0.5';
    dropZone.style.pointerEvents = 'none';
    dropZone.ondragover = null;
    dropZone.ondragleave = null;
    dropZone.ondrop = null;
    dropZone.onclick = null;
    dropZone.querySelector('div:nth-child(2)').textContent = 'Selecciona una obra para habilitar la carga';
    dropZone.querySelector('div:nth-child(2)').style.color = '#999';
    if (info) info.textContent = '';
    // Limpiar archivos pendientes
    if (pendingFiles.length > 0) clearFiles();
  }
}

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
  const obraDestino = document.getElementById('obraDestinoSelect')?.value;
  if (!obraDestino) {
    showToast('Selecciona una obra destino antes de importar', 'error');
    return;
  }
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

  const baseUrl = '/import/armadetailer?obra_destino=' + encodeURIComponent(obraDestino);

  for (let i = 0; i < total; i++) {
    const f = pendingFiles[i];
    progress.textContent = `Importando ${i+1} de ${total}: ${f.name}...`;
    await setGlobalStatus(`Importando archivo ${i+1}/${total}...`, 'warn');

    const data = await apiPostFile(baseUrl, f);

    if (!data) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: sesión expirada</div>`;
      errorCount++;
      continue;
    }
    if (data.ok === false && data.duplicate_file) {
      const replace = confirm(`⚠️ ${data.mensaje}\n\n[Aceptar] = Reemplazar carga anterior\n[Cancelar] = Omitir este archivo`);
      if (!replace) {
        results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: omitido (carga previa conservada)</div>`;
        errorCount++;
        continue;
      }
      const delRes = await apiDelete('/cargas/' + data.carga_existente_id);
      if (!delRes || !delRes.ok) {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: no se pudo eliminar la carga anterior (${delRes?.detail || 'error'})</div>`;
        errorCount++;
        continue;
      }
      const data2 = await apiPostFile(baseUrl + '&forzar=true', f);
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
