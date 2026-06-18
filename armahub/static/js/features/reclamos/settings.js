// ArmaHub Reclamos — Configuración (tab Calidad / Configuración)
// Tarea 5B (preparado 2026-06-16). Gestión de plantillas de correo (CRUD).
// El ENVÍO real de correo se implementa aparte; aquí solo se administran plantillas.
// File-scope global (window), sin IIFE, igual que el resto de features de reclamos.

var _recSettingsTemplates = [];

// Sub-navegación dentro de Mailing (Plantillas / Cierre Reclamos / Envío automático).
function switchRecSettingsTab(sub) {
  var panels = { templates: 'recSetPanelTemplates', cierre: 'recSetPanelCierre', reglas: 'recSetPanelReglas' };
  var btns = { templates: 'recSetBtnTemplates', cierre: 'recSetBtnCierre', reglas: 'recSetBtnReglas' };
  Object.keys(panels).forEach(function(key) {
    var p = document.getElementById(panels[key]);
    if (p) p.style.display = (key === sub) ? '' : 'none';
    var b = document.getElementById(btns[key]);
    if (b) {
      b.style.borderBottomColor = (key === sub) ? '#607D8B' : 'transparent';
      b.style.color = (key === sub) ? '#607D8B' : '#999';
    }
  });
  if (sub === 'cierre') initRecCierre();
}

// ===== Cierre Reclamos: lista de cerrados + envío de informe =====
var _recCierreData = [];

async function initRecCierre() {
  // Cargar todos los cerrados una vez, poblar el filtro de años y mostrar.
  var data = await apiGet('/reclamos/cerrados-envio');
  _recCierreData = Array.isArray(data) ? data : [];
  var anios = {};
  _recCierreData.forEach(function(r) { if (r.anio) anios[r.anio] = true; });
  var sel = document.getElementById('recCierreAnio');
  var aniosOrden = Object.keys(anios).map(Number).sort(function(a, b) { return b - a; });
  sel.innerHTML = '<option value="">Todos</option>' + aniosOrden.map(function(a) {
    return '<option value="' + a + '">' + a + '</option>';
  }).join('');
  // Default "Todos": así se ven todos los cerrados de entrada (incluidos legacy
  // sin año). El admin filtra por año si la lista crece mucho.
  sel.value = '';
  renderRecCierreLista();
}

// Recarga desde backend (botón ↻) — reusa initRecCierre conservando el año si existe.
async function loadRecCierreReclamos() {
  var prev = document.getElementById('recCierreAnio').value;
  await initRecCierre();
  var sel = document.getElementById('recCierreAnio');
  if (prev && Array.prototype.some.call(sel.options, function(o) { return o.value === prev; })) {
    sel.value = prev;
  }
  renderRecCierreLista();
}

function renderRecCierreLista() {
  var cont = document.getElementById('recCierreLista');
  if (!cont) return;
  var anio = document.getElementById('recCierreAnio').value;
  var lista = _recCierreData.filter(function(r) { return !anio || String(r.anio) === anio; });
  if (lista.length === 0) {
    cont.innerHTML = '<div class="muted" style="font-size:12px;">No hay reclamos cerrados' + (anio ? ' en ' + anio : '') + '.</div>';
    return;
  }
  var html = '<table style="width:100%; font-size:12px; border-collapse:collapse;">'
    + '<thead><tr style="text-align:left; color:#888; border-bottom:1px solid #eee;">'
    + '<th style="padding:6px 8px;">Reclamo</th><th style="padding:6px 8px;">Obra</th>'
    + '<th style="padding:6px 8px;">Envío</th><th style="padding:6px 8px; text-align:right;"></th></tr></thead><tbody>';
  lista.forEach(function(r) {
    var enviado = r.envios_ok > 0;
    var estado = enviado
      ? '<span style="color:#2e7d32; font-weight:600;">✓ Enviado</span> <span class="muted">(' + (r.ultimo_envio || '').substring(0, 10) + ')</span>'
      : '<span style="color:#e65100; font-weight:600;">Pendiente</span>';
    // Clic en la fila → abre el modal de DETALLE (revisar). Botón al final →
    // abre directo el modal de ENVÍO (sin pasar por el detalle). stopPropagation
    // para que el botón no dispare también la apertura del detalle.
    var btn = '<button style="font-size:11px; padding:3px 12px; background:#2e7d32; color:#fff; border:none; border-radius:4px; cursor:pointer;" '
      + 'onclick="event.stopPropagation(); abrirEnviarInformeModal(' + r.id + ', ' + (enviado ? 'true' : 'false') + ')">'
      + (enviado ? 'Reenviar' : 'Enviar') + '</button>';
    html += '<tr style="border-bottom:1px solid #f5f5f5; cursor:pointer;" onclick="_abrirReclamoDesdeCierre(' + r.id + ')" title="Ver ficha del reclamo">'
      + '<td style="padding:6px 8px;"><strong>' + _recSetEsc(r.correlativo) + '</strong> ' + _recSetEsc((r.titulo || '').substring(0, 40)) + '</td>'
      + '<td style="padding:6px 8px;">' + _recSetEsc(r.proyecto || '—') + '</td>'
      + '<td style="padding:6px 8px;">' + estado + '</td>'
      + '<td style="padding:6px 8px; text-align:right;">' + btn + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  cont.innerHTML = html;
}

// Abre el modal de detalle del reclamo desde Cierre Reclamos (contexto 'cierre'),
// reciclando el mismo modal de Validaciones. El botón "Enviar informe" aparece
// dentro del modal en este contexto.
function _abrirReclamoDesdeCierre(id) {
  if (typeof _ensureModalFueraDeSubpaneles === 'function') _ensureModalFueraDeSubpaneles();
  if (typeof verReclamo === 'function') verReclamo(id, { origen: 'cierre' });
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
