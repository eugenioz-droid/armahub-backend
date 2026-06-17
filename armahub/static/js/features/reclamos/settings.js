// ArmaHub Reclamos — Configuración (tab Calidad / Configuración)
// Tarea 5B (preparado 2026-06-16). Gestión de plantillas de correo (CRUD).
// El ENVÍO real de correo se implementa aparte; aquí solo se administran plantillas.
// File-scope global (window), sin IIFE, igual que el resto de features de reclamos.

var _recSettingsTemplates = [];

// Sub-navegación dentro de Configuración (Plantillas / Trazabilidad / Envío automático).
function switchRecSettingsTab(sub) {
  var panels = { templates: 'recSetPanelTemplates', traza: 'recSetPanelTraza', reglas: 'recSetPanelReglas' };
  var btns = { templates: 'recSetBtnTemplates', traza: 'recSetBtnTraza', reglas: 'recSetBtnReglas' };
  Object.keys(panels).forEach(function(key) {
    var p = document.getElementById(panels[key]);
    if (p) p.style.display = (key === sub) ? '' : 'none';
    var b = document.getElementById(btns[key]);
    if (b) {
      b.style.borderBottomColor = (key === sub) ? '#607D8B' : 'transparent';
      b.style.color = (key === sub) ? '#607D8B' : '#999';
    }
  });
  if (sub === 'traza') loadRecEnviosTraza();
}

// Trazabilidad: historial global de envíos de informe por correo.
async function loadRecEnviosTraza() {
  var cont = document.getElementById('recSetTrazaLista');
  if (!cont) return;
  cont.innerHTML = '<div class="muted" style="font-size:12px;">Cargando…</div>';
  var data = await apiGet('/admin/correo-envios');
  var lista = Array.isArray(data) ? data : [];
  if (lista.length === 0) {
    cont.innerHTML = '<div class="muted" style="font-size:12px;">Aún no se ha enviado ningún informe por correo.</div>';
    return;
  }
  var html = '<table style="width:100%; font-size:12px; border-collapse:collapse;">'
    + '<thead><tr style="text-align:left; color:#888; border-bottom:1px solid #eee;">'
    + '<th style="padding:6px 8px;">Estado</th><th style="padding:6px 8px;">Reclamo</th>'
    + '<th style="padding:6px 8px;">Destinatarios</th><th style="padding:6px 8px;">Enviado por</th>'
    + '<th style="padding:6px 8px;">Fecha</th></tr></thead><tbody>';
  lista.forEach(function(e) {
    var ok = e.estado === 'enviado';
    var badge = ok
      ? '<span style="color:#2e7d32; font-weight:600;">✓ Enviado</span>'
      : '<span style="color:#c62828; font-weight:600;" title="' + _recSetEsc(e.error || '') + '">✕ Falló</span>';
    html += '<tr style="border-bottom:1px solid #f5f5f5;">'
      + '<td style="padding:6px 8px;">' + badge + '</td>'
      + '<td style="padding:6px 8px;">' + _recSetEsc(e.correlativo || ('#' + e.reclamo_id)) + '</td>'
      + '<td style="padding:6px 8px;">' + _recSetEsc(e.destinatarios || '') + '</td>'
      + '<td style="padding:6px 8px;">' + _recSetEsc(e.enviado_por || '') + '</td>'
      + '<td style="padding:6px 8px; white-space:nowrap;">' + _recSetEsc((e.fecha || '').substring(0, 16).replace('T', ' ')) + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  cont.innerHTML = html;
}

// Entry point del tab (llamado desde el botón de nivel 1).
async function loadRecSettings() {
  var nuevoBtn = document.getElementById('recSetTemplateNuevoBtn');
  if (nuevoBtn) nuevoBtn.style.display = '';
  await loadRecSettingsTemplates();
}

async function loadRecSettingsTemplates() {
  var cont = document.getElementById('recSetTemplatesLista');
  if (!cont) return;
  var data = await apiGet('/admin/correo-templates');
  _recSettingsTemplates = Array.isArray(data) ? data : [];
  if (_recSettingsTemplates.length === 0) {
    cont.innerHTML = '<div class="muted" style="font-size:12px;">Sin plantillas. Crea la primera con "+ Nueva plantilla".</div>';
    return;
  }
  var html = '<div style="display:flex; flex-direction:column; gap:8px;">';
  _recSettingsTemplates.forEach(function(t) {
    html += '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 12px; border:1px solid #eee; border-radius:6px;">'
      + '<div style="min-width:0;">'
      + '<div style="font-weight:600; font-size:13px;">' + _recSetEsc(t.nombre || t.clave) + ' <span class="muted" style="font-weight:400; font-size:11px;">(' + _recSetEsc(t.clave) + ')</span></div>'
      + '<div class="muted" style="font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + _recSetEsc(t.asunto || '') + '</div>'
      + '</div>'
      + '<div style="display:flex; gap:6px; flex-shrink:0;">'
      + '<button class="secondary" style="font-size:11px; padding:3px 10px;" onclick="recSettingsEditarPlantilla(' + t.id + ')">Editar</button>'
      + '<button style="font-size:11px; padding:3px 10px; background:#ffebee; color:#c62828; border:none; border-radius:4px; cursor:pointer;" onclick="recSettingsEliminarPlantilla(' + t.id + ')">✕</button>'
      + '</div></div>';
  });
  html += '</div>';
  cont.innerHTML = html;
}

function _recSetEsc(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function recSettingsNuevaPlantilla() {
  document.getElementById('recSetTplId').value = '';
  document.getElementById('recSetTplClave').value = '';
  document.getElementById('recSetTplNombre').value = '';
  document.getElementById('recSetTplAsunto').value = '';
  document.getElementById('recSetTplCuerpo').value = '';
  document.getElementById('recSetTplMsg').textContent = '';
  document.getElementById('recSetTemplateEditor').style.display = '';
}

function recSettingsEditarPlantilla(id) {
  var t = _recSettingsTemplates.filter(function(x) { return x.id === id; })[0];
  if (!t) return;
  document.getElementById('recSetTplId').value = t.id;
  document.getElementById('recSetTplClave').value = t.clave || '';
  document.getElementById('recSetTplNombre').value = t.nombre || '';
  document.getElementById('recSetTplAsunto').value = t.asunto || '';
  document.getElementById('recSetTplCuerpo').value = t.cuerpo || '';
  document.getElementById('recSetTplMsg').textContent = '';
  document.getElementById('recSetTemplateEditor').style.display = '';
}

function recSettingsCancelarPlantilla() {
  document.getElementById('recSetTemplateEditor').style.display = 'none';
}

async function recSettingsGuardarPlantilla() {
  var msg = document.getElementById('recSetTplMsg');
  var id = document.getElementById('recSetTplId').value;
  var clave = document.getElementById('recSetTplClave').value.trim();
  if (!clave) { msg.textContent = 'La clave es obligatoria'; msg.style.color = '#b42318'; return; }
  var body = {
    clave: clave,
    nombre: document.getElementById('recSetTplNombre').value.trim(),
    asunto: document.getElementById('recSetTplAsunto').value.trim(),
    cuerpo: document.getElementById('recSetTplCuerpo').value,
    activo: true
  };
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  var url = id ? apiUrl('/admin/correo-templates/' + id) : apiUrl('/admin/correo-templates');
  var res = await fetch(url, {
    method: id ? 'PUT' : 'POST',
    headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (res.ok && data.ok) {
    msg.textContent = '✓ Guardado'; msg.style.color = '#558B2F';
    document.getElementById('recSetTemplateEditor').style.display = 'none';
    await loadRecSettingsTemplates();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function recSettingsEliminarPlantilla(id) {
  if (!confirm('¿Eliminar esta plantilla de correo?')) return;
  var res = await fetch(apiUrl('/admin/correo-templates/' + id), { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  await loadRecSettingsTemplates();
}
