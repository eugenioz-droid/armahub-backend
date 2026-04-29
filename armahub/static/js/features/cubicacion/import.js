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

    // ── 1) Preview (no toca BD) — para decidir reemplazo selectivo ──
    let extraParams = '';
    let previewSkippedReason = null;
    try {
      const prev = await fetchImportPreview(obraDestino, f);
      if (prev && prev.ok) {
        const hasReplaces = (prev.matrix || []).some(m => m.action_default === 'replace');
        if (hasReplaces) {
          // Mostrar modal y obtener decisión del usuario
          const decision = await showImportPreviewModal(prev);
          if (!decision) {
            // Cancelado
            results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: cancelado por el usuario</div>`;
            errorCount++;
            continue;
          }
          if (decision.replace_keys) extraParams += '&replace_keys=' + encodeURIComponent(decision.replace_keys);
          if (decision.replace_full_planos) extraParams += '&replace_full_planos=' + encodeURIComponent(decision.replace_full_planos);
        }
        // Si no hay reemplazos: importar directo (todo es ADD)
      } else if (prev && prev.error) {
        previewSkippedReason = prev.error;
      }
    } catch (e) {
      previewSkippedReason = String(e);
    }

    const data = await apiPostFile(baseUrl + extraParams, f);

    if (!data) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: sesión expirada</div>`;
      errorCount++;
      continue;
    }
    if (data.ok === false && data.duplicate_file) {
      // Fallback legacy — mantenido por compatibilidad
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
      const data2 = await apiPostFile(baseUrl + extraParams + '&forzar=true', f);
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

// ========================= PREVIEW DE IMPORTACIÓN =========================

async function fetchImportPreview(obraDestino, file) {
  try {
    const url = '/import/armadetailer/preview?obra_destino=' + encodeURIComponent(obraDestino);
    const data = await apiPostFile(url, file);
    if (!data) return { ok: false, error: 'sin respuesta' };
    return data;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showImportPreviewModal(preview) {
  return new Promise(resolve => {
    const planosTxt = (preview.planos || []).join(', ') || '(sin plano detectado)';
    const m = preview.matrix || [];
    const s = preview.summary || {};

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center;';

    let rowsHtml = '';
    m.forEach(r => {
      let bg = '#f5f5f5', label = 'Sin tocar', icon = '·';
      if (r.action_default === 'add')      { bg = '#e8f5e9'; label = 'Agregar';   icon = '＋'; }
      if (r.action_default === 'replace')  { bg = '#fff3cd'; label = 'Reemplazar';icon = '↻'; }
      if (r.action_default === 'keep')     { bg = '#fafafa'; label = 'Sin tocar'; icon = '·'; }
      rowsHtml += `<tr style="background:${bg};">`
        + `<td style="padding:4px 8px;">${_esc(r.plano_code) || '-'}</td>`
        + `<td style="padding:4px 8px;">${_esc(r.piso) || '-'}</td>`
        + `<td style="padding:4px 8px;">${_esc(r.ciclo) || '-'}</td>`
        + `<td style="padding:4px 8px; text-align:right;">${r.barras_db}</td>`
        + `<td style="padding:4px 8px; text-align:right;">${r.barras_csv}</td>`
        + `<td style="padding:4px 8px; font-weight:600;">${icon} ${label}</td>`
        + `</tr>`;
    });
    if (!rowsHtml) {
      rowsHtml = '<tr><td colspan="6" style="padding:8px; text-align:center; color:#888;">Sin combinaciones para mostrar.</td></tr>';
    }

    overlay.innerHTML = `
      <div style="background:#fff; width:min(900px, 95vw); max-height:90vh; overflow:auto; border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,0.3);">
        <div style="padding:14px 20px; border-bottom:1px solid #e0e0e0; background:#f8f9fa;">
          <h3 style="margin:0 0 6px 0; font-size:16px;">Confirmar importación — ${_esc(preview.archivo)}</h3>
          <div style="font-size:12px; color:#555;">
            <b>Obra:</b> ${_esc(preview.obra_nombre)} ·
            <b>Plano(s):</b> ${_esc(planosTxt)}
          </div>
          <div style="font-size:12px; color:#555; margin-top:4px;">
            CSV: <b>${s.total_csv || 0}</b> barras ·
            BD (en estos planos): <b>${s.total_db_en_planos || 0}</b> ·
            A reemplazar: <b style="color:#b45309;">${s.total_db_a_reemplazar || 0}</b>
          </div>
        </div>

        <div style="padding:12px 20px;">
          <div style="font-size:12px; color:#666; margin-bottom:6px;">
            <b>Regla:</b> se reemplazan los <b>(plano, piso, ciclo)</b> presentes en el archivo.
            Los pisos/ciclos no incluidos en el archivo <b>no se tocan</b>.
          </div>
          <div style="overflow:auto; max-height:50vh; border:1px solid #e0e0e0; border-radius:4px;">
            <table style="width:100%; border-collapse:collapse; font-size:12px;">
              <thead style="position:sticky; top:0; background:#f8f9fa; z-index:1;">
                <tr>
                  <th style="padding:6px 8px; text-align:left;">Plano</th>
                  <th style="padding:6px 8px; text-align:left;">Piso</th>
                  <th style="padding:6px 8px; text-align:left;">Ciclo</th>
                  <th style="padding:6px 8px; text-align:right;">Barras BD</th>
                  <th style="padding:6px 8px; text-align:right;">Barras CSV</th>
                  <th style="padding:6px 8px; text-align:left;">Acción</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>

          <div style="margin-top:10px; font-size:11px; color:#666;">
            <span style="display:inline-block; width:10px; height:10px; background:#e8f5e9; border:1px solid #c8e6c9; vertical-align:middle;"></span> Agregar &nbsp;
            <span style="display:inline-block; width:10px; height:10px; background:#fff3cd; border:1px solid #ffe082; vertical-align:middle;"></span> Reemplazar &nbsp;
            <span style="display:inline-block; width:10px; height:10px; background:#fafafa; border:1px solid #e0e0e0; vertical-align:middle;"></span> Sin tocar
          </div>
        </div>

        <div style="padding:12px 20px; border-top:1px solid #e0e0e0; background:#f8f9fa; display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
          <button id="impPrevCancel" class="secondary" style="padding:6px 14px;">Cancelar</button>
          <button id="impPrevFull" style="padding:6px 14px; background:#fff3cd; color:#92400e; border:1px solid #f59e0b;" title="Borra TODAS las barras de los planos del archivo y carga sólo lo del CSV">⚠ Cargar todo el plano</button>
          <button id="impPrevConfirm" class="primary" style="padding:6px 14px; background:#1976d2; color:#fff; border:none;">✓ Confirmar (regla)</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function close(v) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(v);
    }

    overlay.querySelector('#impPrevCancel').onclick = () => close(null);

    overlay.querySelector('#impPrevConfirm').onclick = () => {
      const keys = m.filter(r => r.action_default === 'replace').map(r => r.key);
      close({
        action: 'rule',
        replace_keys: keys.join(';'),
        replace_full_planos: '',
      });
    };

    overlay.querySelector('#impPrevFull').onclick = () => {
      const planos = preview.planos || [];
      const totalDel = s.total_db_en_planos || 0;
      const ok = confirm(
        '⚠ ATENCIÓN — Cargar todo el plano\n\n'
        + 'Esta opción ELIMINA todas las barras existentes en BD para el/los plano(s):\n'
        + '   ' + (planos.join(', ') || '(sin plano)') + '\n\n'
        + 'Se borrarán ' + totalDel + ' barras existentes y se cargará solo el contenido del CSV.\n\n'
        + 'Pisos/ciclos cargados anteriormente que no estén en el CSV se PERDERÁN.\n\n'
        + '¿Confirmar?'
      );
      if (!ok) return;
      close({
        action: 'full',
        replace_keys: '',
        replace_full_planos: planos.join(';'),
      });
    };
  });
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
