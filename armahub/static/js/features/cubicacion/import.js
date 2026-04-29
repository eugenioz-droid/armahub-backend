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

  // ── FASE 1: Preview de todas las planillas (no toca BD) ──
  progress.textContent = `Analizando ${total} planilla${total>1?'s':''}...`;
  await setGlobalStatus(`Analizando ${total} planilla${total>1?'s':''}...`, 'warn');
  const previews = [];
  for (let i = 0; i < total; i++) {
    const f = pendingFiles[i];
    progress.textContent = `Analizando ${i+1} de ${total}: ${f.name}...`;
    const prev = await fetchImportPreview(obraDestino, f);
    if (!prev || !prev.ok) {
      console.warn('[import] preview falló para', f.name, prev);
    }
    previews.push({ file: f, preview: prev });
  }

  // Si TODOS los preview fallaron, abortar con mensaje claro
  // (el endpoint puede no estar deployado, o el CSV no es válido)
  const previewsValidos = previews.filter(p => p.preview && p.preview.ok);
  if (previewsValidos.length === 0) {
    const motivos = previews.map(p => `• ${p.file.name}: ${p.preview?.error || 'sin respuesta del servidor'}`).join('\n');
    results.innerHTML = `<div class="status-err" style="padding:8px 0; font-size:13px; white-space:pre-wrap;">❌ No se pudo analizar ninguna planilla. La importación se canceló para evitar reemplazos accidentales.\n\n${motivos}\n\nVerifica que el servidor esté actualizado y vuelve a intentar.</div>`;
    btn.disabled = false; btn.style.opacity = '1';
    progress.textContent = '';
    await setGlobalStatus('Análisis falló — importación cancelada', 'err');
    return;
  }
  if (previewsValidos.length < total) {
    const fallidas = previews.filter(p => !p.preview || !p.preview.ok).map(p => p.file.name).join(', ');
    showToast('No se pudo analizar: ' + fallidas + '. Esas planillas se omitirán.', 'error');
  }

  // ── FASE 2: Modal único si hay reemplazos en alguna planilla ──
  const hayReemplazos = previewsValidos.some(p =>
    (p.preview.ejes || []).some(e => e.action === 'replace')
  );

  let decisionGlobal = { mode: 'rule' }; // por defecto: aplicar regla
  if (hayReemplazos) {
    progress.textContent = '';
    decisionGlobal = await showImportPreviewModalMulti(previewsValidos);
    if (!decisionGlobal) {
      // Cancelado
      results.innerHTML = `<div class="status-warn" style="padding:6px 0; font-size:13px;">⏭️ Importación cancelada por el usuario.</div>`;
      btn.disabled = false; btn.style.opacity = '1';
      progress.textContent = '';
      await setGlobalStatus('Importación cancelada', 'warn');
      return;
    }
  }

  // ── FASE 3: Importar cada planilla con la decisión correspondiente ──
  for (let i = 0; i < total; i++) {
    const f = pendingFiles[i];
    const prev = previews[i].preview;

    // Si el preview de ESTA planilla falló, omitirla (no caer al popup legacy)
    if (!prev || !prev.ok) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">⚠️ ${f.name}: omitida (preview falló: ${prev?.error || 'sin respuesta'})</div>`;
      errorCount++;
      continue;
    }

    progress.textContent = `Importando ${i+1} de ${total}: ${f.name}...`;
    await setGlobalStatus(`Importando archivo ${i+1}/${total}...`, 'warn');

    let extraParams = '';
    if (decisionGlobal.mode === 'full') {
      if (prev.full_planos) extraParams += '&replace_full_planos=' + encodeURIComponent(prev.full_planos);
    } else {
      if (prev.replace_keys) extraParams += '&replace_keys=' + encodeURIComponent(prev.replace_keys);
    }
    // El usuario ya confirmó en el modal → saltar la detección de duplicate_file
    extraParams += '&forzar=true';

    const data = await apiPostFile(baseUrl + extraParams, f);

    if (!data) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: sesión expirada</div>`;
      errorCount++;
      continue;
    }
    if (data.ok === false && data.duplicate_file) {
      // No debería pasar (ya enviamos forzar=true), pero por si acaso
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: detección de duplicado inesperada — recarga la página</div>`;
      errorCount++;
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
    if (data.barras_eliminadas_previo) validInfo += ` ↻ ${data.barras_eliminadas_previo} reemplazadas`;
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

// Modal único acumulador para todas las planillas a importar.
// Muestra cada planilla con su lista de ejes y pide UNA sola decisión global.
function showImportPreviewModalMulti(previews) {
  return new Promise(resolve => {
    // Totales globales
    let gTotalCsv = 0, gTotalReplace = 0, gTotalSinTocar = 0;
    let gEjesReplace = 0, gEjesAdd = 0;
    const planosGlobales = new Set();
    previews.forEach(item => {
      const s = item.preview.summary || {};
      gTotalCsv      += s.total_csv || 0;
      gTotalReplace  += s.total_db_a_reemplazar || 0;
      gTotalSinTocar += s.total_db_sin_tocar || 0;
      gEjesReplace   += s.ejes_a_reemplazar || 0;
      gEjesAdd       += s.ejes_a_agregar || 0;
      (item.preview.planos || []).forEach(p => planosGlobales.add(p));
    });

    // HTML de cada planilla
    let blocks = '';
    previews.forEach((item, idx) => {
      const p = item.preview;
      const s = p.summary || {};
      const planosTxt = (p.planos || []).join(', ') || '(sin plano)';

      // Filtrar a ejes con acción ≠ keep + ordenar (replace primero, luego add, luego por eje)
      const ejes = (p.ejes || []).filter(e => e.action === 'replace' || e.action === 'add' || e.sin_tocar > 0);
      ejes.sort((a, b) => {
        const order = { replace: 0, add: 1, keep: 2 };
        if (order[a.action] !== order[b.action]) return order[a.action] - order[b.action];
        if (a.plano_code !== b.plano_code) return a.plano_code.localeCompare(b.plano_code);
        return (a.eje || '').localeCompare(b.eje || '');
      });

      let rowsHtml = '';
      ejes.forEach(e => {
        let bg, label, icon;
        if (e.action === 'replace') { bg = '#fff3cd'; label = 'Reemplazar'; icon = '↻'; }
        else if (e.action === 'add') { bg = '#e8f5e9'; label = 'Agregar';    icon = '＋'; }
        else { bg = '#fafafa'; label = 'Sin tocar'; icon = '·'; }
        rowsHtml += `<tr style="background:${bg};">`
          + `<td style="padding:3px 8px;">${_esc(e.plano_code) || '-'}</td>`
          + `<td style="padding:3px 8px; font-weight:600;">${_esc(e.eje) || '-'}</td>`
          + `<td style="padding:3px 8px; text-align:right;">${e.existian_zona_replace || 0}</td>`
          + `<td style="padding:3px 8px; text-align:right; font-weight:600;">${e.nuevo_csv || 0}</td>`
          + `<td style="padding:3px 8px; text-align:right; color:#666;">${e.sin_tocar || 0}</td>`
          + `<td style="padding:3px 8px; font-size:11px;">${icon} ${label}</td>`
          + `</tr>`;
      });
      if (!rowsHtml) {
        rowsHtml = '<tr><td colspan="6" style="padding:8px; text-align:center; color:#888;">Sin ejes con cambios — el archivo solo agrega data nueva.</td></tr>';
      }

      blocks += `
        <div style="margin-bottom:14px; border:1px solid #e0e0e0; border-radius:6px; overflow:hidden;">
          <div style="padding:8px 12px; background:#eef5ff; border-bottom:1px solid #d0d7de;">
            <div style="font-weight:700; font-size:13px;">📄 ${_esc(item.file.name)}</div>
            <div style="font-size:11px; color:#555; margin-top:2px;">
              Plano(s): <b>${_esc(planosTxt)}</b> ·
              CSV: <b>${s.total_csv || 0}</b> barras ·
              A reemplazar en BD: <b style="color:#92400e;">${s.total_db_a_reemplazar || 0}</b> ·
              Sin tocar (BD): <b style="color:#374151;">${s.total_db_sin_tocar || 0}</b>
            </div>
          </div>
          <div style="overflow:auto; max-height:340px;">
            <table style="width:100%; border-collapse:collapse; font-size:12px;">
              <thead style="position:sticky; top:0; background:#f8f9fa; z-index:1; border-bottom:1px solid #e0e0e0;">
                <tr>
                  <th style="padding:5px 8px; text-align:left;">Plano</th>
                  <th style="padding:5px 8px; text-align:left;">Eje</th>
                  <th style="padding:5px 8px; text-align:right;" title="Barras que ya existen en BD para este eje en los pisos/ciclos que vienen en el CSV (serán reemplazadas)">Existían (a reemplazar)</th>
                  <th style="padding:5px 8px; text-align:right;" title="Barras que aporta este archivo CSV para este eje">Nuevas (CSV)</th>
                  <th style="padding:5px 8px; text-align:right;" title="Barras de este eje en otros pisos/ciclos no incluidos en el CSV — se conservan">Sin tocar</th>
                  <th style="padding:5px 8px; text-align:left;">Acción</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      `;
    });

    const planosListaTxt = Array.from(planosGlobales).join(', ') || '(sin plano)';
    const cantArchivos = previews.length;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#fff; width:min(1100px, 96vw); max-height:92vh; display:flex; flex-direction:column; border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,0.3);">

        <div style="padding:14px 20px; border-bottom:1px solid #e0e0e0; background:#f8f9fa;">
          <h3 style="margin:0 0 6px 0; font-size:16px;">Confirmar importación — ${cantArchivos} planilla${cantArchivos>1?'s':''}</h3>
          <div style="font-size:12px; color:#444;">
            Plano(s) afectado(s): <b>${_esc(planosListaTxt)}</b>
          </div>
          <div style="font-size:12px; color:#444; margin-top:3px;">
            Total CSV: <b>${gTotalCsv}</b> barras ·
            A reemplazar en BD: <b style="color:#92400e;">${gTotalReplace}</b> ·
            Se conservan: <b>${gTotalSinTocar}</b> ·
            Ejes: <b>${gEjesReplace}</b> reemplazar · <b>${gEjesAdd}</b> agregar
          </div>
        </div>

        <div style="padding:12px 20px; overflow:auto; flex:1;">
          <div style="font-size:12px; color:#444; margin-bottom:10px; padding:8px 12px; background:#f0f7ff; border-left:3px solid #1976d2; border-radius:4px;">
            <b>¿Cómo se aplicará?</b><br>
            <b>Reemplazo selectivo</b> (recomendado): borra solo las barras de los <i>(piso, ciclo)</i> que vienen en cada archivo y carga las nuevas. Las barras en otros pisos/ciclos (columna <i>Sin tocar</i>) se conservan.<br>
            <b>Reemplazo total del plano</b>: borra TODAS las barras del plano (incluidas las "Sin tocar") y carga sólo lo que viene en los archivos.
          </div>
          ${blocks}
        </div>

        <div style="padding:12px 20px; border-top:1px solid #e0e0e0; background:#f8f9fa; display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
          <button id="impPrevCancel" class="secondary" style="padding:8px 14px;">Cancelar</button>
          <button id="impPrevFull" style="padding:8px 14px; background:#fff3cd; color:#92400e; border:1px solid #f59e0b; cursor:pointer;" title="Borra TODAS las barras de los planos afectados, incluso las que están sin tocar">⚠ Reemplazar plano completo</button>
          <button id="impPrevConfirm" class="primary" style="padding:8px 14px; background:#1976d2; color:#fff; border:none; cursor:pointer;">✓ Reemplazar solo lo que viene en los archivos</button>
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
      close({ mode: 'rule' });
    };

    overlay.querySelector('#impPrevFull').onclick = () => {
      const ok = confirm(
        '⚠ ATENCIÓN — Reemplazar plano completo\n\n'
        + 'Esta opción eliminará TODAS las barras existentes en BD para el/los plano(s):\n'
        + '   ' + planosListaTxt + '\n\n'
        + 'Se borrarán ' + (gTotalReplace + gTotalSinTocar) + ' barras existentes (incluidas las "Sin tocar")\n'
        + 'y se cargará sólo el contenido de las planillas seleccionadas.\n\n'
        + '¿Confirmar?'
      );
      if (!ok) return;
      close({ mode: 'full' });
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
