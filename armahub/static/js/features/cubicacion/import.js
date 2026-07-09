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

  // ── FASE 2: Modal único si hay reemplazos o códigos desfasados en alguna planilla ──
  const hayReemplazos = previewsValidos.some(p =>
    (p.preview.pisos || []).some(e => e.action === 'replace')
  );
  const hayDesfasados = previewsValidos.some(p =>
    (p.preview.cod_prod_desfasados || []).length > 0
  );

  let decisionGlobal = { mode: 'rule', approvedIdx: null }; // por defecto: aplicar regla a todas
  if (hayReemplazos || hayDesfasados) {
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

  // Set de índices aprobados (referenciados al array previewsValidos)
  // Si no hubo modal, todas las planillas con preview ok están aprobadas implícitamente
  let approvedFiles = null;
  if (decisionGlobal.approvedIdx) {
    approvedFiles = new Set(decisionGlobal.approvedIdx.map(i => previewsValidos[i].file));
  }

  // ── FASE 3: Importar cada planilla con la decisión correspondiente ──
  for (let i = 0; i < total; i++) {
    const f = pendingFiles[i];
    const prev = previews[i].preview;

    // Si el preview de ESTA planilla falló, omitirla
    if (!prev || !prev.ok) {
      results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">⚠️ ${f.name}: omitida (preview falló: ${prev?.error || 'sin respuesta'})</div>`;
      errorCount++;
      continue;
    }

    // Si el modal se mostró y esta planilla NO fue marcada, omitirla
    if (approvedFiles && !approvedFiles.has(f)) {
      results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: no aprobada en el modal — omitida</div>`;
      errorCount++;
      continue;
    }

    progress.textContent = `Importando ${i+1} de ${total}: ${f.name}...`;
    await setGlobalStatus(`Importando archivo ${i+1}/${total}...`, 'warn');

    let extraParams = '';
    if (prev.replace_keys) extraParams += '&replace_keys=' + encodeURIComponent(prev.replace_keys);
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
    if (data.cod_prod_corregidos > 0) validInfo += ` 🔧 ${data.cod_prod_corregidos} código${data.cod_prod_corregidos > 1 ? 's' : ''} corregido${data.cod_prod_corregidos > 1 ? 's' : ''}`;
    const statusClass = data.estado === 'ok' ? 'status-ok' : 'status-warn';
    totalBarrasImported += (data.barras || 0);
    totalKilosImported += (data.kilos || 0);
    results.innerHTML += `<div class="${statusClass}" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data.barras} barras (${data.proyecto})${kilosText}${validInfo}</div>`;
    if (data.rejected && data.rejected.length > 0) {
      results.innerHTML += `<div class="muted" style="padding:2px 0 4px 20px; font-size:11px;">Rechazadas: ${data.rejected.slice(0,5).join(', ')}</div>`;
    }
    // Aviso de fundaciones mal catalogadas (sector=FUND en piso != PF).
    if (data.fund_misplaced && data.fund_misplaced.length > 0) {
      const detalle = data.fund_misplaced
        .map(x => `${x.piso}: ${x.barras} barras · ${Math.round(x.kg).toLocaleString('es-CL')} kg`)
        .join(' · ');
      results.innerHTML +=
        `<div style="margin:4px 0 6px 20px; padding:8px 12px; background:#fff3cd; ` +
        `border:1px solid #ffc107; color:#856404; border-radius:4px; font-size:12px;">` +
        `⚠️ <strong>Fundaciones mal catalogadas:</strong> hay barras con sector ` +
        `<code>FUND</code> asignadas a pisos distintos de <code>PF</code> → ${detalle}. ` +
        `Corrige el piso en la cubicación de origen para reflejar correctamente el nivel base.` +
        `</div>`;
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
    if (typeof loadCargas === 'function') await loadCargas();
    if (typeof loadProyectos === 'function') await loadProyectos();
    if (typeof loadFilters === 'function') await loadFilters();
    if (typeof loadInicio === 'function') await loadInicio();
    if (typeof loadMiActividad === 'function') await loadMiActividad();
    if (typeof loadDashboard === 'function') await loadDashboard('sector');
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
// 1 fila por piso (colapsando multi-plano dentro del mismo CSV).
// Por planilla: radios "Importar" / "Omitir" — el usuario debe elegir uno.
function showImportPreviewModalMulti(previews) {
  return new Promise(resolve => {
    // Totales globales
    let gTotalCsv = 0, gTotalReplace = 0;
    let gPisosReplace = 0, gPisosAdd = 0;
    const planosGlobales = new Set();
    previews.forEach(item => {
      const s = item.preview.summary || {};
      gTotalCsv      += s.total_csv || 0;
      gTotalReplace  += s.total_db_a_reemplazar || 0;
      gPisosReplace  += s.pisos_a_reemplazar || 0;
      gPisosAdd      += s.pisos_a_sumar || 0;
      (item.preview.planos || []).forEach(p => planosGlobales.add(p));
    });

    // HTML de cada planilla
    let blocks = '';
    previews.forEach((item, idx) => {
      const p = item.preview;
      const s = p.summary || {};
      const planosTxt = (p.planos || []).join(', ') || '(sin plano)';
      const ejesTxt   = (p.ejes   || []).join(', ') || '(sin eje)';
      const pisos = p.pisos || [];

      let rowsHtml = '';
      pisos.forEach(r => {
        let bg, label, icon;
        if (r.action === 'replace') { bg = '#fff3cd'; label = 'Reemplazar';   icon = '↻'; }
        else                        { bg = '#e8f5e9'; label = 'Sumar';        icon = '＋'; }
        rowsHtml += `<tr style="background:${bg};">`
          + `<td style="padding:3px 8px;">${_esc(r.eje) || '-'}</td>`
          + `<td style="padding:3px 8px; font-weight:600;">${_esc(r.piso) || '-'}</td>`
          + `<td style="padding:3px 8px; text-align:right;">${r.existentes_bd || 0}</td>`
          + `<td style="padding:3px 8px; text-align:right; font-weight:600;">${r.nuevas_csv || 0}</td>`
          + `<td style="padding:3px 8px; text-align:right; color:#1565C0; font-weight:600;">${r.final || 0}</td>`
          + `<td style="padding:3px 8px; font-size:11px;">${icon} ${label}</td>`
          + `</tr>`;
      });
      if (!rowsHtml) {
        rowsHtml = '<tr><td colspan="6" style="padding:8px; text-align:center; color:#888;">El archivo no tiene pisos detectables.</td></tr>';
      }

      // Warning si hay multi-plano
      let multiWarning = '';
      if (p.multi_plano_warning) {
        const detalle = (p.ejes_multi_plano || [])
          .map(e => `${_esc(e.eje)}: ${e.planos.map(_esc).join(' / ')}`)
          .join(' · ');
        multiWarning = `
          <div style="margin-top:4px; font-size:11px; color:#b91c1c; font-weight:600;">
            ⚠ Detectado más de un código de plano en este CSV (bug Detailer).
            Las filas se agrupan por piso para evitar duplicación visual.
            ${detalle ? `<br><span style="font-weight:400;">Detalle: ${detalle}</span>` : ''}
          </div>
        `;
      }

      // Warning de códigos de producto desfasados respecto al diámetro
      let codProdWarning = '';
      const desfasados = p.cod_prod_desfasados || [];
      if (desfasados.length > 0) {
        const ejemplos = desfasados.slice(0, 5).map(d =>
          `Fila ${d.fila}: Ø${d.diam}mm → código actual <b>${_esc(d.cod_actual)}</b>, se corregirá a <b>${_esc(d.cod_esperado)}</b>`
        ).join('<br>');
        const resto = desfasados.length > 5 ? `<br><span style="color:#92400e;">...y ${desfasados.length - 5} más</span>` : '';
        codProdWarning = `
          <div style="margin-top:6px; padding:8px 10px; background:#fff3cd; border:1px solid #ffc107; border-radius:4px; font-size:11px; color:#856404;">
            ⚠ <b>${desfasados.length} barra${desfasados.length > 1 ? 's tienen' : ' tiene'} código de producto desfasado.</b>
            Al importar, ArmaHub corregirá automáticamente el código según el diámetro:<br>
            <span style="display:inline-block; margin-top:4px;">${ejemplos}${resto}</span>
          </div>
        `;
      }

      blocks += `
        <div data-block="${idx}" style="margin-bottom:14px; border:1px solid #e0e0e0; border-radius:6px; overflow:hidden;">
          <div style="padding:10px 12px; background:#eef5ff; border-bottom:1px solid #d0d7de; display:flex; align-items:flex-start; gap:12px;">
            <div style="flex:1; min-width:0;">
              <div style="font-weight:700; font-size:13px;">📄 ${_esc(item.file.name)}</div>
              <div style="font-size:11px; color:#555; margin-top:2px;">
                Eje(s): <b>${_esc(ejesTxt)}</b> ·
                Plano(s): <b>${_esc(planosTxt)}</b>
              </div>
              <div style="font-size:11px; color:#555; margin-top:2px;">
                CSV: <b>${s.total_csv || 0}</b> barras ·
                A reemplazar: <b style="color:#92400e;">${s.total_db_a_reemplazar || 0}</b> ·
                Pisos: <b>${s.pisos_a_reemplazar || 0}</b> reemplazar / <b>${s.pisos_a_sumar || 0}</b> sumar
              </div>
              ${multiWarning}
              ${codProdWarning}
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0; min-width:130px; padding:4px 10px; background:#fff; border:1px solid #d0d7de; border-radius:6px;">
              <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; font-weight:600; color:#15803d;">
                <input type="radio" name="impPrevAction-${idx}" value="import" data-idx="${idx}" class="imp-prev-radio" style="cursor:pointer;">
                ✓ Importar
              </label>
              <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; font-weight:600; color:#9a3412;">
                <input type="radio" name="impPrevAction-${idx}" value="skip" data-idx="${idx}" class="imp-prev-radio" style="cursor:pointer;">
                ⊘ Omitir
              </label>
            </div>
          </div>
          <div style="overflow:auto; max-height:340px;">
            <table style="width:100%; border-collapse:collapse; font-size:12px;">
              <thead style="position:sticky; top:0; background:#f8f9fa; z-index:1; border-bottom:1px solid #e0e0e0;">
                <tr>
                  <th style="padding:5px 8px; text-align:left;">Eje</th>
                  <th style="padding:5px 8px; text-align:left;">Piso</th>
                  <th style="padding:5px 8px; text-align:right;" title="Barras que ya existen en BD para ese piso (todos los ciclos)">Existentes</th>
                  <th style="padding:5px 8px; text-align:right;" title="Barras que aporta este CSV en ese piso">Nueva carga (CSV)</th>
                  <th style="padding:5px 8px; text-align:right;" title="Total que quedará tras importar = (existentes en ciclos no incluidos) + (nuevas del CSV)">Final</th>
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

    // Pre-parsear replace_keys de cada CSV en arrays de claves (plano|piso|ciclo)
    const previewKeys = previews.map(item => {
      const raw = item.preview && item.preview.replace_keys ? String(item.preview.replace_keys) : '';
      return raw ? raw.split(';').filter(Boolean) : [];
    });

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
            Pisos: <b>${gPisosReplace}</b> reemplazar · <b>${gPisosAdd}</b> sumar
          </div>
          <div id="impPrevOverlapWarn" style="display:none; margin-top:8px; padding:8px 12px; background:#fee2e2; border-left:3px solid #b91c1c; border-radius:4px; font-size:12px; color:#991b1b;"></div>
        </div>

        <div style="padding:12px 20px; overflow:auto; flex:1;">
          <div style="font-size:12px; color:#444; margin-bottom:10px; padding:8px 12px; background:#f0f7ff; border-left:3px solid #1976d2; border-radius:4px;">
            <b>Cómo se aplica:</b>
            por cada <i>(piso, ciclo)</i> presente en el archivo se borran las barras existentes y se cargan las nuevas.
            Los pisos/ciclos no incluidos en el archivo <b>no se tocan</b> (su data se ve reflejada en la columna <i>Final</i>).
            <br><b>Importante:</b> elige <b>Importar</b> u <b>Omitir</b> para cada planilla. La confirmación se habilita cuando todas tienen acción definida.
          </div>
          ${blocks}
        </div>

        <div style="padding:12px 20px; border-top:1px solid #e0e0e0; background:#f8f9fa; display:flex; gap:8px; justify-content:space-between; align-items:center; flex-wrap:wrap;">
          <div style="font-size:12px; color:#555;">
            <span id="impPrevDecided">0</span> / ${cantArchivos} con decisión ·
            <span id="impPrevImport">0</span> a importar ·
            <span id="impPrevSkip">0</span> a omitir
          </div>
          <div style="display:flex; gap:8px;">
            <button id="impPrevCancel" class="secondary" style="padding:8px 14px;">Cancelar</button>
            <button id="impPrevConfirm" class="primary" disabled style="padding:8px 14px; background:#bbb; color:#fff; border:none; cursor:not-allowed;">✓ Confirmar</button>
          </div>
        </div>

      </div>
    `;
    document.body.appendChild(overlay);

    const radios = overlay.querySelectorAll('.imp-prev-radio');
    const btnConfirm = overlay.querySelector('#impPrevConfirm');
    const cDecided = overlay.querySelector('#impPrevDecided');
    const cImport  = overlay.querySelector('#impPrevImport');
    const cSkip    = overlay.querySelector('#impPrevSkip');
    const warnBox  = overlay.querySelector('#impPrevOverlapWarn');

    function getDecisions() {
      const decisions = {}; // idx → 'import' | 'skip'
      radios.forEach(r => {
        if (r.checked) decisions[r.dataset.idx] = r.value;
      });
      return decisions;
    }

    // Detecta solapamiento de claves (plano|piso|ciclo) entre los CSVs marcados como 'import'.
    // Devuelve [{key, files:[name,...]}, ...] sólo para claves repetidas.
    function detectOverlaps(approvedIdxList) {
      const map = new Map(); // key → [idx, idx, ...]
      approvedIdxList.forEach(i => {
        (previewKeys[i] || []).forEach(k => {
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(i);
        });
      });
      const conflicts = [];
      map.forEach((idxs, key) => {
        if (idxs.length > 1) {
          conflicts.push({
            key,
            files: idxs.map(i => previews[i].file.name),
          });
        }
      });
      return conflicts;
    }

    function refreshState() {
      const d = getDecisions();
      const decided = Object.keys(d).length;
      const approvedIdxList = Object.keys(d).filter(k => d[k] === 'import').map(k => parseInt(k, 10));
      const importCount = approvedIdxList.length;
      const skipCount   = Object.values(d).filter(v => v === 'skip').length;
      cDecided.textContent = decided;
      cImport.textContent  = importCount;
      cSkip.textContent    = skipCount;

      // Overlap entre CSVs aprobados
      const conflicts = detectOverlaps(approvedIdxList);
      if (conflicts.length > 0) {
        // Agrupar conflictos por par de archivos para el mensaje
        const pairsMap = new Map();
        conflicts.forEach(c => {
          const sig = c.files.slice().sort().join(' ↔ ');
          if (!pairsMap.has(sig)) pairsMap.set(sig, []);
          pairsMap.get(sig).push(c.key);
        });
        let html = '⚠ <b>Solapamiento detectado entre planillas seleccionadas para importar.</b>'
          + ' Hay claves <i>(eje · piso · ciclo)</i> que aparecen en más de un CSV — sólo prevalecerá la última en cargarse y la otra se perderá silenciosamente. Revisa antes de confirmar.';
        html += '<ul style="margin:6px 0 0 0; padding-left:18px;">';
        pairsMap.forEach((keys, sig) => {
          const sample = keys.slice(0, 4).map(k => k.replace(/\|/g, ' · ')).join(', ');
          const more = keys.length > 4 ? ` y ${keys.length - 4} más` : '';
          html += `<li><b>${_esc(sig)}</b> — ${keys.length} clave(s) en conflicto: ${_esc(sample)}${_esc(more)}</li>`;
        });
        html += '</ul>';
        warnBox.innerHTML = html;
        warnBox.style.display = '';
      } else {
        warnBox.innerHTML = '';
        warnBox.style.display = 'none';
      }

      const allOk = decided === cantArchivos;
      btnConfirm.disabled = !allOk;
      if (allOk) {
        if (conflicts.length > 0) {
          btnConfirm.style.background = '#b91c1c';
          btnConfirm.textContent = '⚠ Confirmar con solapamientos';
        } else {
          btnConfirm.style.background = '#1976d2';
          btnConfirm.textContent = '✓ Confirmar';
        }
        btnConfirm.style.cursor = 'pointer';
      } else {
        btnConfirm.style.background = '#bbb';
        btnConfirm.style.cursor = 'not-allowed';
        btnConfirm.textContent = '✓ Confirmar';
      }
    }
    radios.forEach(r => r.addEventListener('change', refreshState));
    refreshState();

    function close(v) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(v);
    }

    overlay.querySelector('#impPrevCancel').onclick = () => close(null);

    btnConfirm.onclick = () => {
      if (btnConfirm.disabled) return;
      const d = getDecisions();
      const approvedIdx = Object.keys(d).filter(k => d[k] === 'import').map(k => parseInt(k, 10));
      close({ mode: 'rule', approvedIdx });
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
