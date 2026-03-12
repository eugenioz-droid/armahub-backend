// ArmaHub — Main Application JavaScript
// Extracted from ui.py for maintainability

// ========================= AUTH =========================
function token() { return localStorage.getItem('armahub_token'); }
function authHeaders() {
  const t = token();
  return t ? { "Authorization": "Bearer " + t } : {};
}
function logout() {
  localStorage.removeItem('armahub_token');
  window.location.href = '/ui/login';
}

async function cambiarMiClave() {
  var currentPass = prompt('Contraseña actual:');
  if (!currentPass) return;
  var newPass = prompt('Nueva contraseña (mín. 6 caracteres):');
  if (!newPass) return;
  if (newPass.length < 6) { alert('La contraseña debe tener al menos 6 caracteres'); return; }
  var confirmPass = prompt('Confirmar nueva contraseña:');
  if (confirmPass !== newPass) { alert('Las contraseñas no coinciden'); return; }
  var params = new URLSearchParams({ current_password: currentPass, new_password: newPass });
  var res = await fetch('/me/password?' + params.toString(), { method: 'POST', headers: authHeaders() });
  if (res.status === 401) { alert('Contraseña actual incorrecta'); return; }
  var data = await res.json();
  if (data.ok) { alert('Contraseña actualizada correctamente'); } else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function apiGet(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) { logout(); return null; }
  
  let data = null;
  try { data = await res.json(); } catch (e) {
    console.error("JSON parse error:", e);
    await setGlobalStatus("Error: respuesta inválida", "err");
    return null;
  }
  
  if (!res.ok) {
    const msg = data?.detail || data?.error || ("HTTP " + res.status);
    console.error("API Error:", msg, data);
    await setGlobalStatus("Error: " + msg, "err");
    return null;
  }
  
  return data;
}

async function apiPost(url, params) {
  const res = await fetch(url + "?" + new URLSearchParams(params).toString(), {
    method: 'POST',
    headers: authHeaders()
  });
  if (res.status === 401) { logout(); return null; }
  return { ok: res.ok, data: await res.json() };
}

async function apiPostFile(url, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: form });
  if (res.status === 401) { logout(); return null; }
  try {
    return await res.json();
  } catch (e) {
    console.error("apiPostFile JSON parse error:", e, "status:", res.status);
    return { ok: false, error: "Error del servidor (HTTP " + res.status + ")" };
  }
}

async function apiPostJson(url, body) {
  const h = authHeaders();
  h['Content-Type'] = 'application/json';
  const res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  if (res.status === 401) { logout(); return null; }
  return await res.json();
}

async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) { logout(); return null; }
  return await res.json();
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
  populateCalcSelect('newProjCalculistaSelect');
  document.getElementById('newProjCalculistaSelect').value = '';
  document.getElementById('newProjCalculistaInput').style.display = 'none';
  document.getElementById('newProjCalculistaInput').value = '';
  document.getElementById('newProjCalculista').value = '';

  // Load users for owner select
  const sel = document.getElementById('newProjOwner');
  sel.innerHTML = '<option value="">Cargando...</option>';
  const usersData = await apiGet('/users/list');
  if (usersData && usersData.users) {
    const me = localStorage.getItem('armahub_email') || '';
    sel.innerHTML = usersData.users.map(u =>
      `<option value="${u.id}" ${u.email === me ? 'selected' : ''}>${u.email} (${u.role})</option>`
    ).join('');
  }

  // Populate client selector
  var clSel = document.getElementById('newProjCliente');
  if (clSel) {
    clSel.innerHTML = '<option value="">\u2014 Sin constructora \u2014</option>' +
      _clientesCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
  }

  const modal = document.getElementById('newProjectModal');
  modal.style.display = 'flex';

  return new Promise(resolve => { _newProjResolve = resolve; });
}

function closeNewProjectModal(confirmed) {
  document.getElementById('newProjectModal').style.display = 'none';
  if (_newProjResolve) {
    if (confirmed) {
      syncCalcHidden('newProj');
      _newProjResolve({
        confirmed: true,
        calculista: document.getElementById('newProjCalculista').value.trim(),
        owner_id: document.getElementById('newProjOwner').value || '',
        cliente_id: document.getElementById('newProjCliente') ? document.getElementById('newProjCliente').value : '',
      });
    } else {
      _newProjResolve({ confirmed: false });
    }
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

  document.getElementById('missingProjectModal').style.display = 'flex';
  return new Promise(function(resolve) { _missProjResolve = resolve; });
}

function closeMissingProjectModal(action) {
  document.getElementById('missingProjectModal').style.display = 'none';
  if (!_missProjResolve) return;
  if (action === 'existing') {
    var projId = document.getElementById('missProjExistente').value;
    if (!projId) { alert('Selecciona un proyecto'); document.getElementById('missingProjectModal').style.display = 'flex'; return; }
    _missProjResolve({ action: 'existing', proyecto_id: projId });
  } else if (action === 'new') {
    var nombre = document.getElementById('missProjNombre').value.trim();
    if (!nombre) { alert('Ingresa un nombre para el proyecto'); document.getElementById('missingProjectModal').style.display = 'flex'; return; }
    syncCalcHidden('missProj');
    _missProjResolve({
      action: 'new',
      nombre: nombre,
      calculista: document.getElementById('missProjCalculista').value.trim(),
      owner_id: document.getElementById('missProjOwner').value || '',
      cliente_id: document.getElementById('missProjCliente').value || '',
    });
  } else {
    _missProjResolve({ action: 'cancel' });
  }
  _missProjResolve = null;
}

// ========================= UI =========================
async function setGlobalStatus(text, kind = 'info') {
  const el = document.getElementById('globalStatus');
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : kind === 'warn' ? 'status-warn' : 'muted';
  el.textContent = text || '';
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

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  
  document.getElementById('tab-' + tabName).classList.add('active');
  // Find the button that triggered the switch
  const btns = document.querySelectorAll('.tab-btn');
  const tabLabels = { inicio:'Inicio', obras:'Obras', buscar:'Bar Manager', dashboards:'Dashboards', pedidos:'Pedidos', export:'Exportación', reclamos:'Reclamos', admin:'Admin' };
  const label = tabLabels[tabName] || tabName;
  btns.forEach(b => { if (b.textContent.includes(label)) b.classList.add('active'); });
}

let currentModule = 'hub';

function switchModule(mod) {
  const hub = document.getElementById('hubScreen');
  const container = document.getElementById('moduleContainer');
  const title = document.getElementById('moduleTitle');

  if (mod === 'hub') {
    // Back to Hub
    container.style.display = 'none';
    hub.style.display = 'block';
    currentModule = 'hub';
    return;
  }

  // Show module container, hide hub
  hub.style.display = 'none';
  container.style.display = 'block';
  currentModule = mod;

  // Module config: which tab buttons to show, default tab, title
  const modules = {
    cubicacion: { css: 'mod-cubicacion', defaultTab: 'inicio', title: 'Cubicación' },
    reclamos:   { css: 'mod-reclamos',   defaultTab: 'reclamos', title: 'Reclamos' },
    admin:      { css: 'mod-admin',      defaultTab: 'admin', title: 'Administración' },
  };
  const cfg = modules[mod];
  if (!cfg) return;

  title.textContent = cfg.title;

  // Show only tab buttons for this module
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.classList.contains(cfg.css)) {
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
  });

  // Apply role-based visibility within the module
  if (mod === 'cubicacion') {
    // Cliente: only inicio + dashboards
    var clienteHideTabs = ['obras','buscar','pedidos','export'];
    if (currentRole === 'cliente') {
      document.querySelectorAll('.tab-btn.mod-cubicacion').forEach(btn => {
        var onclick = btn.getAttribute('onclick') || '';
        var match = onclick.match(/switchTab\('(\w+)'\)/);
        if (match && clienteHideTabs.includes(match[1])) btn.style.display = 'none';
      });
    }
  }
  if (mod === 'reclamos') {
    // Hide create card for roles that cannot create reclamos
    var puedeCrear = ['admin','admin2','usc'].includes(currentRole);
    var crearCard = document.getElementById('crearReclamoCard');
    if (crearCard) crearCard.style.display = puedeCrear ? '' : 'none';
    // USC: hide asignado_a dropdown (auto-assigned to self)
    var asigCol = document.getElementById('recAsignadoA');
    if (asigCol && asigCol.parentElement) {
      asigCol.parentElement.style.display = (currentRole === 'admin' || currentRole === 'admin2') ? '' : 'none';
    }
  }
  if (mod === 'admin') {
    var esAdmin = (currentRole === 'admin');
    // Coordinador: hide calculistas, data cleanup, DB state, DB reset
    var hideForCoord = ['adminCalculistasCard','adminGestionDatosCard','adminEstadoBdCard','adminResetBdCard'];
    hideForCoord.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.display = esAdmin ? '' : 'none'; });
    // Coordinador: restrict role dropdown to USC only
    var roleSel = document.getElementById('newUserRole');
    if (roleSel && !esAdmin) {
      roleSel.innerHTML = '<option value="usc">USC</option>';
    }
  }

  // Switch to default tab
  switchTab(cfg.defaultTab);
}

// ========================= INIT =========================
let currentRole = 'usc';
let currentUserEmail = '';

async function loadMe() {
  const me = await apiGet('/me');
  if (!me) return;
  var displayName = ((me.nombre || '') + ' ' + (me.apellido || '')).trim();
  document.getElementById('whoEmail').textContent = displayName || me.email;
  document.getElementById('whoRole').textContent = "Rol: " + me.role;
  localStorage.setItem('armahub_email', me.email);
  currentRole = me.role || 'usc';
  currentUserEmail = me.email || '';

  // --- Hub card visibility by role ---
  const cubicacionAccess = ['admin','cubicador','cliente'];
  const reclamosAccess = ['admin','admin2','cubicador','usc','externo'];
  const adminAccess = ['admin','admin2'];
  const hubCubicacion = document.getElementById('hubCardCubicacion');
  const hubReclamos = document.getElementById('hubCardReclamos');
  const hubAdmin = document.getElementById('hubCardAdmin');
  if (hubCubicacion) hubCubicacion.style.display = cubicacionAccess.includes(currentRole) ? '' : 'none';
  if (hubReclamos) hubReclamos.style.display = reclamosAccess.includes(currentRole) ? '' : 'none';
  if (hubAdmin) hubAdmin.style.display = adminAccess.includes(currentRole) ? '' : 'none';

  // Show Hub screen
  document.getElementById('hubScreen').style.display = 'block';

  // Status message
  const roleLabels = {admin:'ADMIN', admin2:'Admin2', cubicador:'Cubicador', usc:'USC', externo:'Externo', cliente:'Cliente'};
  await setGlobalStatus("Sesión como " + (roleLabels[currentRole] || currentRole), "ok");
}

async function loadProyectos() {
  const data = await apiGet('/proyectos');
  if (!data) return;
  
  const container = document.getElementById('proyectosContainer');
  if (!data.proyectos || data.proyectos.length === 0) {
    container.innerHTML = '<div class="muted">No hay proyectos cargados</div>';
    return;
  }
  
  container.innerHTML = data.proyectos.map(p => {
    const ownerText = p.owner_email ? p.owner_email : '(sin dueño)';
    const calcText = p.calculista_nombre || p.calculista || '';
    return `
    <div class="card" style="margin: 12px 0; padding: 16px; border-left: 4px solid #8BC34A;">
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <h4 style="margin: 0 0 6px 0;" id="pname-${p.id_proyecto}">${p.nombre_proyecto}</h4>
          <div class="muted" style="margin-bottom:4px;">
            <span class="badge">${p.total_kilos.toFixed(0)} kg</span>
            <span class="badge">${p.total_barras} barras</span>
            <span class="muted" style="font-size:11px; margin-left:8px;">ID: ${p.id_proyecto}</span>
          </div>
          <div style="font-size:11px; color:#666;">
            <span>👤 ${ownerText}</span>
            ${calcText ? '<span style="margin-left:10px;">📐 Calculista: ' + calcText + '</span>' : ''}
            ${p.cliente_nombre ? '<span style="margin-left:10px;">🏢 ' + p.cliente_nombre + '</span>' : ''}
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="secondary" style="font-size:12px; padding:4px 10px;" onclick="toggleCargasProyecto('${p.id_proyecto}')">Cargas</button>
          <button class="secondary" style="font-size:12px; padding:4px 10px;" onclick="toggleAutorizados('${p.id_proyecto}')">Usuarios</button>
          <button class="secondary" style="font-size:12px; padding:4px 10px;" onclick="editarObra('${p.id_proyecto}', '${p.nombre_proyecto.replace(/'/g, "\\'")}')">Renombrar</button>
          <button class="secondary" style="font-size:12px; padding:4px 10px; color:#b42318; border-color:#b42318;" onclick="eliminarObra('${p.id_proyecto}', '${p.nombre_proyecto.replace(/'/g, "\\'")}', ${p.total_barras})">Eliminar</button>
        </div>
      </div>
      <div id="cargas-${p.id_proyecto}" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid #eee;">
        <div style="font-size:12px; font-weight:bold; margin-bottom:6px;">Historial de cargas</div>
        <div id="cargas-list-${p.id_proyecto}" class="muted" style="font-size:12px;">Cargando...</div>
      </div>
      <div id="autorizados-${p.id_proyecto}" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid #eee;">
        <div style="font-size:12px; font-weight:bold; margin-bottom:6px;">Usuarios autorizados</div>
        <div id="autorizados-list-${p.id_proyecto}" class="muted" style="font-size:12px;">Cargando...</div>
        <div style="display:flex; gap:6px; align-items:center; margin-top:8px;">
          <select id="autorizar-user-${p.id_proyecto}" style="font-size:12px; flex:1;"><option>Cargando...</option></select>
          <button class="secondary" style="font-size:11px; padding:3px 8px;" onclick="autorizarUsuario('${p.id_proyecto}')">+ Autorizar</button>
        </div>
      </div>
    </div>
  `}).join('');

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

// ========================= ADMIN OBRAS =========================
async function crearObra() {
  const name = document.getElementById('newObraName').value.trim();
  const calcSel = document.getElementById('newObraCalculista');
  const calcId = calcSel ? calcSel.value : '';
  const clienteSel = document.getElementById('newObraCliente');
  const clienteId = clienteSel ? clienteSel.value : '';
  const msg = document.getElementById('crearObraMsg');
  if (!name) { msg.innerHTML = '<span class="status-err">Ingresa un nombre para la obra</span>'; return; }
  msg.innerHTML = '<span class="muted">Creando...</span>';
  const body = { nombre_proyecto: name };
  if (calcId) body.calculista_id = parseInt(calcId);
  if (clienteId) body.cliente_id = parseInt(clienteId);
  const res = await fetch('/proyectos', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.innerHTML = '<span class="status-ok">Obra creada: ' + data.nombre_proyecto + ' (ID: ' + data.id_proyecto + ')</span>';
    document.getElementById('newObraName').value = '';
    document.getElementById('newObraCalculista').value = '';
    if (clienteSel) clienteSel.value = '';
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    await loadMiActividad();
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || data.error || 'desconocido') + '</span>';
  }
}

// ========================= CARGAS POR PROYECTO =========================
async function toggleCargasProyecto(idProyecto) {
  const panel = document.getElementById('cargas-' + idProyecto);
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
  list.innerHTML = `
    <div style="max-height:350px; overflow-y:auto; border:1px solid #eee; border-radius:4px;">
    <table style="width:100%; font-size:12px;">
      <thead style="position:sticky; top:0; background:#f8f8f8; z-index:1;"><tr><th>Archivo</th><th>Plano</th><th>Barras</th><th>Kilos</th><th>Versión</th><th>Usuario</th><th>Fecha</th><th></th></tr></thead>
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
  list.innerHTML = data.autorizados.map(a => `
    <div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
      <span>${a.email}</span>
      <span class="badge" style="font-size:10px;">${a.rol}</span>
      <button class="secondary" style="font-size:10px; padding:1px 6px; color:#b42318; border-color:#b42318;" onclick="revocarUsuario('${idProyecto}', ${a.user_id})">✕</button>
    </div>
  `).join('');
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
  const res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, rol: 'editor' })
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

async function editarObra(id, nombreActual) {
  const nuevo = prompt('Nuevo nombre para la obra:', nombreActual);
  if (!nuevo || nuevo.trim() === '' || nuevo.trim() === nombreActual) return;
  const res = await fetch('/proyectos/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre_proyecto: nuevo.trim() })
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    await setGlobalStatus('Obra renombrada: ' + nuevo.trim(), 'ok');
    await loadProyectos();
    await loadFilters();
    await loadInicio();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
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
  ['proyecto','plano','sector','piso','ciclo','q','order_by','order_dir'].forEach(f => {
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
  loadFilters(proy ? { proyecto: proy } : null);
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
      <span class="muted">(${(f.size/1024).toFixed(1)} KB)</span>
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
        if (missResult.cliente_id) retryUrl += '&cliente_id=' + encodeURIComponent(missResult.cliente_id);
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
      // Proyecto nuevo detectado — mostrar popup para confirmar creación
      const modalResult = await openNewProjectModal(data);
      if (!modalResult.confirmed) {
        results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: creación cancelada</div>`;
        errorCount++;
        continue;
      }
      let retryUrl = '/import/armadetailer?confirmar_nuevo=true';
      if (modalResult.calculista) retryUrl += '&calculista=' + encodeURIComponent(modalResult.calculista);
      if (modalResult.owner_id) retryUrl += '&owner_id=' + encodeURIComponent(modalResult.owner_id);
      if (modalResult.cliente_id) retryUrl += '&cliente_id=' + encodeURIComponent(modalResult.cliente_id);
      const data2 = await apiPostFile(retryUrl, f);
      if (data2 && data2.ok) {
        const kilosText2 = data2.kilos ? ` — ${Math.round(data2.kilos).toLocaleString()} kg` : '';
        totalBarrasImported += (data2.barras || 0);
        totalKilosImported += (data2.kilos || 0);
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.barras} barras (${data2.proyecto})${kilosText2} (nuevo proyecto)</div>`;
        successCount++;
      } else {
        results.innerHTML += `<div class="status-err" style="padding:4px 0; font-size:13px;">❌ ${f.name}: ${data2?.error || data2?.mensaje || 'Error creando proyecto'}</div>`;
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
  const data = await apiGet('/cargas/recientes?limit=5');
  if (!data) { container.innerHTML = '<div class="muted">Error cargando historial</div>'; return; }
  if (!data.cargas || data.cargas.length === 0) {
    container.innerHTML = '<div class="muted">No hay cargas registradas</div>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;">
      <thead><tr>
        <th>Proyecto</th><th>Archivo</th><th>Plano</th><th>Barras</th><th>Kilos</th><th>Versión</th><th>Usuario</th><th>Fecha</th>
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
          estadoBadge = `<span style="background:#fff3cd; color:#856404; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:600;" title="${(c.errores || 'Algunas filas rechazadas').replace(/"/g, '&quot;')}">&#9888; PARCIAL</span> `;
          rowBg = ' style="background:#fffde7;"';
        } else if (c.estado === 'error') {
          estadoBadge = `<span style="background:#ffcdd2; color:#b42318; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:600;" title="${(c.errores || 'Todas las filas rechazadas').replace(/"/g, '&quot;')}">&#10060; ERROR</span> `;
          rowBg = ' style="background:#fff5f5;"';
        }
        return `<tr${rowBg}>
          <td>${estadoBadge}<strong>${c.nombre_proyecto || c.id_proyecto}</strong></td>
          <td class="muted" style="font-size:11px;">${c.archivo || '-'}</td>
          <td class="muted" style="font-size:11px;">${c.plano_code || '-'}</td>
          <td>${c.barras_count}</td>
          <td>${Math.round(c.kilos || 0).toLocaleString()} kg</td>
          <td class="muted" style="font-size:11px;">${c.version_archivo || '-'}</td>
          <td class="muted">${c.usuario}</td>
          <td class="muted" style="font-size:11px;">${fecha}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  `;
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
  const si = document.getElementById('proyectoSearchInput');
  if (si) si.value = '';
  try { localStorage.removeItem(FILTER_STORAGE_KEY); } catch(e) {}
  selectedBarras.clear();
  updateToolbar();
  loadFilters();
  buscar(true);
}

function verBarrasCarga(importId, idProyecto, archivo) {
  // Switch to Bar Manager tab
  switchTab('buscar');

  // Set project filter
  var proySel = document.getElementById('proyecto');
  if (proySel) proySel.value = idProyecto;

  // Set carga filter
  document.getElementById('filtroCarga').value = importId;
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
          const bg = isDone ? '#e8f5e9' : (isSelected ? '#e3f0ff' : '#fff');
          const border = isSelected ? '2px solid #4285f4' : '1px solid #ccc';
          const doneTitle = isDone ? ' | Exportado ' + hist.veces + 'x, \u00faltimo: ' + (hist.ultima_fecha || '').substring(0, 10) : '';
          html += '<td style="border:' + border + '; padding:2px 4px; background:' + bg + '; text-align:center; cursor:pointer; position:relative; transition:all 0.12s; min-width:80px; white-space:nowrap;" ';
          html += 'onclick="exportToggleCell(\'' + exportKey + '\')" ';
          html += 'title="' + tipo + ' ' + piso + ' ' + ciclo + ': ' + d.barras + ' barras, ' + Math.round(d.kilos).toLocaleString() + ' kg' + doneTitle + '">';
          // Checkbox
          html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' style="position:absolute; top:1px; left:1px; width:11px; height:11px; pointer-events:none; accent-color:#4285f4;" />';
          // Done badge
          if (isDone) {
            html += '<span style="position:absolute; top:0px; right:2px; font-size:9px; color:#558B2F;" title="Exportado ' + hist.veces + ' vez(es)">&#10004;</span>';
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
  const ctx = document.getElementById('dashChart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
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
    if (sectoresChart) { sectoresChart.destroy(); sectoresChart = null; }
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
  const ctx = document.getElementById('sectoresChart').getContext('2d');
  if (sectoresChart) sectoresChart.destroy();
  sectoresChart = new Chart(ctx, {
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
        y: { type: 'linear', position: 'left', title: { display: true, text: 'Kilos' }, ticks: { callback: v => v.toLocaleString() } },
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
let inicioChart = null;
let timelineChart = null;
let _inicioFechaDesde = '';
let _inicioFechaHasta = '';
let _inicioAgrupacion = 'dia';

function _dateParams() {
  const params = new URLSearchParams();
  if (_inicioFechaDesde) params.set('fecha_desde', _inicioFechaDesde);
  if (_inicioFechaHasta) params.set('fecha_hasta', _inicioFechaHasta);
  return params.toString();
}

function setDateRange(range) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (range === 'todo') {
    _inicioFechaDesde = '';
    _inicioFechaHasta = '';
  } else if (range === 'semana') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    _inicioFechaDesde = d.toISOString().slice(0, 10);
    _inicioFechaHasta = today;
  } else if (range === 'mes') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    _inicioFechaDesde = d.toISOString().slice(0, 10);
    _inicioFechaHasta = today;
  } else if (range === 'anio') {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    _inicioFechaDesde = d.toISOString().slice(0, 10);
    _inicioFechaHasta = today;
  } else if (range === 'custom') {
    _inicioFechaDesde = document.getElementById('fechaDesde').value || '';
    _inicioFechaHasta = document.getElementById('fechaHasta').value || '';
  }

  // Update date inputs
  document.getElementById('fechaDesde').value = _inicioFechaDesde;
  document.getElementById('fechaHasta').value = _inicioFechaHasta;

  // Update active button
  document.querySelectorAll('.btn-periodo').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector('.btn-periodo[data-range="' + range + '"]');
  if (activeBtn) activeBtn.classList.add('active');

  // Update label
  const label = document.getElementById('dateRangeLabel');
  if (_inicioFechaDesde || _inicioFechaHasta) {
    label.textContent = (_inicioFechaDesde || '...') + ' → ' + (_inicioFechaHasta || '...');
  } else {
    label.textContent = '';
  }

  loadInicio();
}

function setAgrupacion(agrup) {
  _inicioAgrupacion = agrup;
  document.querySelectorAll('.btn-agrupacion').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector('.btn-agrupacion[data-agrup="' + agrup + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  loadTimeline();
}

async function loadInicio() {
  const dp = _dateParams();
  const url = '/stats' + (dp ? '?' + dp : '');
  let data;
  try {
    data = await apiGet(url);
  } catch(e) { console.error('loadInicio error:', e); return; }
  if (!data) return;

  document.getElementById('kpiProyectos').textContent = data.total_proyectos;
  document.getElementById('kpiBarras').textContent = data.total_barras.toLocaleString();
  document.getElementById('kpiKilos').textContent = Math.round(data.total_kilos).toLocaleString() + ' kg';

  // KPIs avanzados
  document.getElementById('kpiPPB').textContent = data.ppb ? data.ppb.toFixed(2) + ' kg' : '—';
  document.getElementById('kpiPPI').textContent = data.ppi ? data.ppi.toFixed(2) + ' kg' : '—';
  document.getElementById('kpiDiam').textContent = data.diam_promedio ? data.diam_promedio.toFixed(1) + ' mm' : '—';
  document.getElementById('kpiItems').textContent = data.total_items ? data.total_items.toLocaleString() : '—';

  if (data.ultima_carga) {
    const d = new Date(data.ultima_carga);
    document.getElementById('kpiUltimaCarga').textContent = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
  } else {
    document.getElementById('kpiUltimaCarga').textContent = 'Sin cargas';
  }

  // Top 5 chart
  const top5 = data.top5 || [];
  const labels = top5.map(p => p.nombre);
  const values = top5.map(p => p.kilos);
  const ctx = document.getElementById('inicioChart').getContext('2d');
  if (inicioChart) inicioChart.destroy();
  inicioChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Kilos', data: values, backgroundColor: '#8BC34A', borderRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: v => v.toLocaleString() + ' kg' } } }
    }
  });

  // Project mini-cards
  const list = document.getElementById('proyectosMiniList');
  if (!data.proyectos || data.proyectos.length === 0) {
    list.innerHTML = '<div class="muted" style="padding:12px;">No hay proyectos cargados</div>';
  } else {
    list.innerHTML = data.proyectos.map(p => `
      <div class="proyecto-mini">
        <span class="pm-name">${p.nombre}</span>
        <span class="pm-kilos">${Math.round(p.kilos).toLocaleString()} kg</span>
      </div>
    `).join('');
  }

  // Load timeline and cubicadores in parallel
  loadTimeline();
  loadCubicadores();
}

async function loadTimeline() {
  const dp = _dateParams();
  const params = new URLSearchParams(dp);
  params.set('agrupacion', _inicioAgrupacion);
  const data = await apiGet('/stats/timeline?' + params.toString());
  if (!data || !data.timeline) return;

  const items = data.timeline;
  const labels = items.map(i => i.periodo);
  const kilosData = items.map(i => i.kilos);
  const barrasData = items.map(i => i.barras);

  const ctx = document.getElementById('timelineChart').getContext('2d');
  if (timelineChart) timelineChart.destroy();
  timelineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Kilos',
          data: kilosData,
          backgroundColor: '#8BC34A',
          borderRadius: 3,
          yAxisID: 'y'
        },
        {
          label: 'Barras',
          data: barrasData,
          type: 'line',
          borderColor: '#558B2F',
          backgroundColor: 'rgba(85, 139, 47, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Kilos', font: { size: 11 } },
          ticks: { callback: v => Math.round(v).toLocaleString() }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Barras', font: { size: 11 } },
          grid: { drawOnChartArea: false },
          ticks: { callback: v => Math.round(v).toLocaleString() }
        },
        x: { ticks: { font: { size: 10 }, maxRotation: 45 } }
      }
    }
  });
}

async function loadCubicadores() {
  const dp = _dateParams();
  const url = '/stats/cubicadores' + (dp ? '?' + dp : '');
  const data = await apiGet(url);
  if (!data || !data.cubicadores) return;

  const tbody = document.getElementById('cubicadoresBody');
  if (data.cubicadores.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Sin actividad en este período</td></tr>';
    return;
  }

  tbody.innerHTML = data.cubicadores.map(c => {
    const fecha = c.ultima_actividad ? new Date(c.ultima_actividad).toLocaleDateString('es-CL') : '—';
    return '<tr>' +
      '<td style="font-weight:500;">' + (c.email || '—') + '</td>' +
      '<td style="text-align:right;">' + (c.barras || 0).toLocaleString() + '</td>' +
      '<td style="text-align:right;">' + Math.round(c.kilos || 0).toLocaleString() + ' kg</td>' +
      '<td style="text-align:right;">' + (c.cargas || 0) + '</td>' +
      '<td style="text-align:right;">' + (c.proyectos || 0) + '</td>' +
      '<td style="text-align:right; font-size:11px; color:#666;">' + fecha + '</td>' +
      '</tr>';
  }).join('');
}

// ========================= MI ACTIVIDAD (Cubicador dashboard) =========================
let miActividadChart = null;

async function loadMiActividad() {
  let data;
  try {
    data = await apiGet('/stats/mi-actividad');
  } catch(e) { console.error('loadMiActividad error:', e); return; }
  if (!data) return;

  const el = id => document.getElementById(id);
  el('miActividadEmail').textContent = data.email || '';
  el('maHoyBarras').textContent = data.hoy.barras.toLocaleString();
  el('maHoyKilos').textContent = Math.round(data.hoy.kilos).toLocaleString() + ' kg';
  el('maHoyCargas').textContent = data.hoy.cargas;
  el('maSemKilos').textContent = Math.round(data.semana_actual.kilos).toLocaleString() + ' kg';

  // Week comparison
  const comp = el('maSemComp');
  const prev = data.semana_anterior.kilos;
  const curr = data.semana_actual.kilos;
  if (prev > 0) {
    const pct = Math.round(((curr - prev) / prev) * 100);
    if (pct >= 0) {
      comp.innerHTML = '<span style="color:#558B2F;">&#9650; ' + pct + '% vs sem. anterior</span>';
    } else {
      comp.innerHTML = '<span style="color:#b42318;">&#9660; ' + Math.abs(pct) + '% vs sem. anterior</span>';
    }
  } else if (curr > 0) {
    comp.innerHTML = '<span style="color:#558B2F;">Sin datos semana anterior</span>';
  } else {
    comp.textContent = '';
  }

  // Mini-chart: last 14 days
  const dias = data.dias || [];
  const labels = dias.map(d => {
    const parts = d.dia.split('-');
    return parts[2] + '/' + parts[1];
  });
  const kilosData = dias.map(d => d.kilos);
  const barrasData = dias.map(d => d.barras);

  // Highlight today (last bar)
  const bgColors = dias.map((d, i) => i === dias.length - 1 ? '#558B2F' : '#8BC34A');

  const ctx = el('miActividadChart').getContext('2d');
  if (miActividadChart) miActividadChart.destroy();
  miActividadChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Kilos',
          data: kilosData,
          backgroundColor: bgColors,
          borderRadius: 2,
          yAxisID: 'y'
        },
        {
          label: 'Barras',
          data: barrasData,
          type: 'line',
          borderColor: '#33691E',
          backgroundColor: 'rgba(51,105,30,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 1.5,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12 } }
      },
      scales: {
        y: {
          type: 'linear', position: 'left',
          title: { display: false },
          ticks: { font: { size: 9 }, callback: v => Math.round(v).toLocaleString() },
          grid: { color: '#f0f0f0' }
        },
        y1: {
          type: 'linear', position: 'right',
          title: { display: false },
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 9 }, callback: v => Math.round(v).toLocaleString() }
        },
        x: { ticks: { font: { size: 9 }, maxRotation: 45 } }
      }
    }
  });
}

// ========================= CLIENTES =========================
let _clientesCache = [];

async function loadClientes() {
  const data = await apiGet('/clientes?activo=true');
  if (!data) return;
  _clientesCache = data.clientes || [];

  // Populate client selector in crear obra
  const sel = document.getElementById('newObraCliente');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- Sin constructora --</option>' +
      _clientesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    if (prev) sel.value = prev;
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

  const res = await fetch('/clientes', {
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
  const res = await fetch('/clientes/' + clienteId, {
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
  html += '<th style="padding:5px 6px;">Cliente</th>';
  html += '<th style="padding:5px 6px;">Barras</th>';
  html += '<th style="padding:5px 6px;">Kilos</th>';
  html += '<th style="padding:5px 6px;">Creador</th>';
  html += '<th style="padding:5px 6px;">Acciones</th></tr>';

  _adminProyectosCache.forEach(function(p) {
    var kilos = p.total_kilos ? Math.round(p.total_kilos).toLocaleString('es-CL') : '0';
    var calc = p.calculista_nombre || p.calculista || '<span class="muted">-</span>';
    var cliente = p.cliente_nombre || '<span class="muted">-</span>';
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
    var cdata = await apiGet('/clientes');
    clienteData = (cdata && cdata.clientes) ? cdata.clientes : [];
  } catch(e) {}
  var clienteOpts = '<option value="0">— Sin constructora —</option>' +
    clienteData.map(function(c) {
      return '<option value="' + c.id + '"' + (c.id === p.cliente_id ? ' selected' : '') + '>' + c.nombre + '</option>';
    }).join('');

  var formHtml = '<div style="padding:12px; background:#e3f2fd; border:1px solid #90caf9; border-radius:8px; margin-bottom:10px;">';
  formHtml += '<h4 style="margin:0 0 8px 0; color:#1565C0; font-size:13px;">Editando: ' + p.nombre_proyecto + '</h4>';
  formHtml += '<div class="row" style="gap:8px; flex-wrap:wrap; align-items:flex-end;">';
  formHtml += '<div class="col" style="flex:2; min-width:200px;"><label style="font-size:11px; color:#666;">Nombre del proyecto *</label>';
  formHtml += '<input type="text" id="editProjNombre" value="' + (p.nombre_proyecto || '').replace(/"/g, '&quot;') + '" style="width:100%; font-size:12px;" /></div>';
  formHtml += '<div class="col" style="max-width:200px;"><label style="font-size:11px; color:#666;">Calculista</label>';
  formHtml += '<select id="editProjCalculista" style="width:100%; font-size:12px;">' + calcOpts + '</select></div>';
  formHtml += '<div class="col" style="max-width:200px;"><label style="font-size:11px; color:#666;">Constructora</label>';
  formHtml += '<select id="editProjCliente" style="width:100%; font-size:12px;">' + clienteOpts + '</select></div>';
  formHtml += '</div>';
  formHtml += '<div style="margin-top:6px;"><label style="font-size:11px; color:#666;">Descripción</label>';
  formHtml += '<textarea id="editProjDescripcion" rows="2" style="width:100%; font-size:12px; resize:vertical;">' + (p.descripcion || '') + '</textarea></div>';
  formHtml += '<div style="margin-top:8px; display:flex; gap:6px; align-items:center;">';
  formHtml += '<button onclick="guardarProyectoAdmin(\'' + p.id_proyecto + '\')" style="font-size:11px; padding:4px 14px;">💾 Guardar</button>';
  formHtml += '<button class="secondary" onclick="loadAdminProyectos()" style="font-size:11px; padding:4px 10px;">Cancelar</button>';
  formHtml += '<span id="editProjMsg" class="muted" style="font-size:11px;"></span>';
  formHtml += '</div></div>';

  // Prepend form above the table
  container.insertAdjacentHTML('afterbegin', formHtml);
  document.getElementById('editProjNombre').focus();
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
    cliente_id: parseInt(document.getElementById('editProjCliente').value) || 0,
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
let _reclamoActual = null;
let _ishikawaData = null;
let _ishikawaTarget = 'create'; // 'create' or 'detail'
let _ishikawaSelection = { categoria: '', sub_causa: '', cod_causa: '' };

const _recEstadoColors = {
  abierto: '#e53935', en_analisis: '#ff9800', accion_correctiva: '#2196F3',
  validacion: '#7B1FA2', cerrado: '#4CAF50', rechazado: '#9E9E9E'
};
const _recEstadoLabels = {
  abierto: 'Abierto', en_analisis: 'En análisis', accion_correctiva: 'Acción correctiva',
  validacion: 'En validación', cerrado: 'Cerrado', rechazado: 'Rechazado'
};
const _recPrioridadColors = {
  baja: '#9E9E9E', media: '#ff9800', alta: '#e53935', critica: '#b71c1c'
};
const _recPrioridadLabels = {
  baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica'
};
const _recIshikawaLabels = {
  mano_de_obra: 'Personas (Mano de obra)', metodo: 'Método', material: 'Material',
  maquina: 'Máquina', medicion: 'Medida', medio_ambiente: 'Medio Ambiente'
};
const _recAplicaLabels = { si: 'Sí aplica', no: 'No aplica', pendiente: 'Pendiente' };
const _recAplicaColors = { si: '#e53935', no: '#4CAF50', pendiente: '#ff9800' };
const _recAccionTipoColors = { inmediata: '#e53935', correctiva: '#2196F3', preventiva: '#4CAF50' };
const _ishikawaCatColors = {
  medio_ambiente: '#26A69A', material: '#5C6BC0', maquina: '#EF5350',
  medicion: '#AB47BC', metodo: '#FFA726', mano_de_obra: '#42A5F5'
};

// ---- RECLAMOS LANDING CHARTS ----
let _recLandChartTipo = null, _recLandChartHist = null, _recLandChartAnio = null, _recLandChartIshikawa = null;
const _recCatColors = {
  mano_de_obra: '#42A5F5', metodo: '#FFA726', material: '#66BB6A',
  maquina: '#EF5350', medicion: '#AB47BC', medio_ambiente: '#26A69A',
  sin_categoria: '#BDBDBD',
};
const _recCatLabels = {
  mano_de_obra: 'Personas', metodo: 'Método', material: 'Material',
  maquina: 'Máquina', medicion: 'Medida', medio_ambiente: 'Medio Amb.',
  sin_categoria: 'Sin cat.',
};

function switchRecTab(tab) {
  var mainTab = document.getElementById('recTabMain');
  var dashTab = document.getElementById('recTabDashboards');
  var btnMain = document.getElementById('recTabBtnMain');
  var btnDash = document.getElementById('recTabBtnDash');
  if (tab === 'dashboards') {
    mainTab.style.display = 'none';
    dashTab.style.display = '';
    btnMain.style.borderBottomColor = 'transparent'; btnMain.style.color = '#999';
    btnDash.style.borderBottomColor = '#1565C0'; btnDash.style.color = '#1565C0';
    loadRecAdminDashboards();
  } else {
    mainTab.style.display = '';
    dashTab.style.display = 'none';
    btnMain.style.borderBottomColor = '#e53935'; btnMain.style.color = '#e53935';
    btnDash.style.borderBottomColor = 'transparent'; btnDash.style.color = '#999';
    _adminDashLoaded = false;
  }
}

async function loadRecLanding() {
  var data = await apiGet('/reclamos/mi-resumen');
  if (!data) return;

  // Title: admin sees "Resumen General", others see "Mi Resumen"
  var isAdmin = (currentRole === 'admin' || currentRole === 'admin2');
  var titleEl = document.querySelector('#recLandingCharts').parentElement.querySelector('h3');
  if (titleEl) titleEl.textContent = isAdmin ? 'Resumen General' : 'Mi Resumen';
  var labelEl = document.getElementById('recLandTotal').parentElement.querySelector('div:first-child');
  if (labelEl) labelEl.textContent = isAdmin ? 'Total Reclamos' : 'Mis Reclamos';

  // Show dashboards tab button for admin
  var dashBtn = document.getElementById('recTabBtnDash');
  if (dashBtn) dashBtn.style.display = isAdmin ? '' : 'none';

  // Show 4th chart for cubicador (and admin)
  var chart4 = document.getElementById('recLandChart4Wrap');
  var showChart4 = (currentRole === 'cubicador' || isAdmin);
  if (chart4) chart4.style.display = showChart4 ? '' : 'none';
  var grid = document.getElementById('recLandingCharts');

  // Chart 1: Total number
  document.getElementById('recLandTotal').textContent = data.total || 0;
  document.getElementById('recLandAbiertos').textContent = (data.abiertos || 0) + ' abiertos';

  // Chart 2: Error vs Faltante — doughnut
  var errCount = data.por_tipo.error || 0;
  var falCount = data.por_tipo.faltante || 0;
  var ctx1 = document.getElementById('recLandChartTipo').getContext('2d');
  if (_recLandChartTipo) _recLandChartTipo.destroy();
  _recLandChartTipo = new Chart(ctx1, {
    type: 'doughnut',
    data: {
      labels: ['Error (' + errCount + ')', 'Faltante (' + falCount + ')'],
      datasets: [{ data: [errCount, falCount], backgroundColor: ['#e53935', '#ff9800'] }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8 } } } }
  });

  // Chart 3: Historical 12-month grouped bar by year
  var _mesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var _anioColores = ['#e53935','#1565C0','#2e7d32','#ff9800','#7B1FA2','#00897B'];
  var anioMesData = data.por_anio_mes || [];
  var aniosSet = {};
  anioMesData.forEach(function(d) { aniosSet[d.anio] = true; });
  var anios = Object.keys(aniosSet).map(Number).sort();
  var datasets = anios.map(function(anio, idx) {
    var counts = new Array(12).fill(0);
    anioMesData.forEach(function(d) { if (d.anio === anio) counts[d.mes - 1] = d.count; });
    return { label: '' + anio, data: counts, backgroundColor: _anioColores[idx % _anioColores.length] };
  });
  var ctx2 = document.getElementById('recLandChartHist').getContext('2d');
  if (_recLandChartHist) _recLandChartHist.destroy();
  _recLandChartHist = new Chart(ctx2, {
    type: 'bar',
    data: { labels: _mesNombres, datasets: datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: anios.length > 1, labels: { font: { size: 9 } } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
  });

  // Chart 4: Reclamos por año (cubicador / admin)
  if (showChart4 && data.por_anio && data.por_anio.length > 0) {
    var anioLabels = data.por_anio.map(function(d) { return '' + d.anio; });
    var anioCounts = data.por_anio.map(function(d) { return d.count; });
    var ctx3 = document.getElementById('recLandChartAnio').getContext('2d');
    if (_recLandChartAnio) _recLandChartAnio.destroy();
    _recLandChartAnio = new Chart(ctx3, {
      type: 'bar',
      data: { labels: anioLabels, datasets: [{ label: 'Reclamos', data: anioCounts, backgroundColor: _anioColores.slice(0, anioCounts.length) }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
  }

  // Chart 5: Ishikawa doughnut (cubicador / admin)
  var showChart5 = (currentRole === 'cubicador' || isAdmin) && data.por_ishikawa && Object.keys(data.por_ishikawa).length > 0;
  var chart5 = document.getElementById('recLandChart5Wrap');
  if (chart5) chart5.style.display = showChart5 ? '' : 'none';
  if (showChart5) {
    var ishKeys = Object.keys(data.por_ishikawa);
    var ishLabels = ishKeys.map(function(k) { return (_recCatLabels[k] || k) + ' (' + data.por_ishikawa[k] + ')'; });
    var ishData = ishKeys.map(function(k) { return data.por_ishikawa[k]; });
    var ishColors = ishKeys.map(function(k) { return _recCatColors[k] || '#BDBDBD'; });
    var ctx5 = document.getElementById('recLandChartIshikawa').getContext('2d');
    if (_recLandChartIshikawa) _recLandChartIshikawa.destroy();
    _recLandChartIshikawa = new Chart(ctx5, {
      type: 'doughnut',
      data: { labels: ishLabels, datasets: [{ data: ishData, backgroundColor: ishColors }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, padding: 6 } } } }
    });
  }

  // Adjust grid columns: count visible charts (3 base + chart4 + chart5)
  var visibleCharts = 3 + (showChart4 ? 1 : 0) + (showChart5 ? 1 : 0);
  if (grid) grid.style.gridTemplateColumns = 'repeat(' + visibleCharts + ', 1fr)';

  // Pending tasks badge (cubicador only)
  var pendWrap = document.getElementById('recLandPendientesWrap');
  var pendCount = data.pendientes || 0;
  if (pendWrap) {
    if (currentRole === 'cubicador' && pendCount > 0) {
      pendWrap.style.display = '';
      document.getElementById('recLandPendientes').textContent = pendCount;
    } else {
      pendWrap.style.display = 'none';
    }
  }
}

// ---- ADMIN DASHBOARDS TAB ----
let _recDashUSC = null, _recDashUSCTipo = null, _recDashUSCHist = null;
let _recDashIshikawa = null, _recDashCub = null, _recDashCubIshikawa = null;
var _adminDashLoaded = false;

async function loadRecAdminDashboards() {
  if (_adminDashLoaded) return;
  var data = await apiGet('/reclamos/admin-dashboards');
  if (!data) return;
  _adminDashLoaded = true;

  var _anioColores = ['#e53935','#1565C0','#2e7d32','#ff9800','#7B1FA2','#00897B'];

  // --- USC Column ---
  // 1) Per-USC total bar chart
  var uscLabels = (data.por_usc || []).map(function(d) { return d.email.split('@')[0]; });
  var uscTotals = (data.por_usc || []).map(function(d) { return d.total; });
  var ctx1 = document.getElementById('recDashChartUSC').getContext('2d');
  if (_recDashUSC) _recDashUSC.destroy();
  _recDashUSC = new Chart(ctx1, {
    type: 'bar',
    data: { labels: uscLabels, datasets: [{ label: 'Reclamos', data: uscTotals, backgroundColor: '#ff9800' }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } } }
  });

  // 2) Per-USC error vs faltante stacked bar
  var uscErrores = (data.por_usc || []).map(function(d) { return d.errores; });
  var uscFaltantes = (data.por_usc || []).map(function(d) { return d.faltantes; });
  var ctx2 = document.getElementById('recDashChartUSCTipo').getContext('2d');
  if (_recDashUSCTipo) _recDashUSCTipo.destroy();
  _recDashUSCTipo = new Chart(ctx2, {
    type: 'bar',
    data: { labels: uscLabels, datasets: [
      { label: 'Error', data: uscErrores, backgroundColor: '#e53935' },
      { label: 'Faltante', data: uscFaltantes, backgroundColor: '#ff9800' }
    ]},
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { labels: { font: { size: 10 } } } },
      scales: { x: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }, y: { stacked: true } } }
  });

  // 3) USC historical — aggregate all USCs by year
  var uscHistData = data.usc_hist || [];
  var uscAniosSet = {};
  uscHistData.forEach(function(d) { uscAniosSet[d.anio] = true; });
  var uscAnios = Object.keys(uscAniosSet).map(Number).sort();
  var _mesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var uscHistDS = uscAnios.map(function(anio, idx) {
    var counts = new Array(12).fill(0);
    uscHistData.forEach(function(d) { if (d.anio === anio) counts[d.mes - 1] += d.count; });
    return { label: '' + anio, data: counts, backgroundColor: _anioColores[idx % _anioColores.length] };
  });
  var ctx3 = document.getElementById('recDashChartUSCHist').getContext('2d');
  if (_recDashUSCHist) _recDashUSCHist.destroy();
  _recDashUSCHist = new Chart(ctx3, {
    type: 'bar',
    data: { labels: _mesNombres, datasets: uscHistDS },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: uscAnios.length > 1, labels: { font: { size: 9 } } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
  });

  // --- Cubicador Column ---
  // 4) Ishikawa global doughnut
  var ishLabels = (data.ishikawa_cubicador || []).map(function(d) { return _recCatLabels[d.categoria] || d.categoria; });
  var ishValues = (data.ishikawa_cubicador || []).map(function(d) { return d.count; });
  var ishColors = (data.ishikawa_cubicador || []).map(function(d) { return _recCatColors[d.categoria] || '#BDBDBD'; });
  var ctx4 = document.getElementById('recDashChartIshikawa').getContext('2d');
  if (_recDashIshikawa) _recDashIshikawa.destroy();
  _recDashIshikawa = new Chart(ctx4, {
    type: 'doughnut',
    data: { labels: ishLabels, datasets: [{ data: ishValues, backgroundColor: ishColors }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { font: { size: 10 } } } } }
  });

  // 5) Per-cubicador total bar
  var cubLabels = (data.por_cubicador || []).map(function(d) { return d.email.split('@')[0]; });
  var cubTotals = (data.por_cubicador || []).map(function(d) { return d.total; });
  var ctx5 = document.getElementById('recDashChartCub').getContext('2d');
  if (_recDashCub) _recDashCub.destroy();
  _recDashCub = new Chart(ctx5, {
    type: 'bar',
    data: { labels: cubLabels, datasets: [{ label: 'Respondidos', data: cubTotals, backgroundColor: '#2e7d32' }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } } }
  });

  // 6) Per-cubicador Ishikawa stacked bar
  var cubIshData = data.ishikawa_per_cub || [];
  var cubEmails = []; var cubEmailSet = {};
  cubIshData.forEach(function(d) { if (!cubEmailSet[d.email]) { cubEmails.push(d.email); cubEmailSet[d.email] = true; } });
  var cubIshLabels = cubEmails.map(function(e) { return e.split('@')[0]; });
  var catKeys = Object.keys(_recCatColors);
  var cubIshDS = catKeys.map(function(cat) {
    var cData = cubEmails.map(function(email) {
      var found = cubIshData.find(function(d) { return d.email === email && d.categoria === cat; });
      return found ? found.count : 0;
    });
    return { label: _recCatLabels[cat] || cat, data: cData, backgroundColor: _recCatColors[cat] || '#BDBDBD' };
  }).filter(function(ds) { return ds.data.some(function(v) { return v > 0; }); });
  var ctx6 = document.getElementById('recDashChartCubIshikawa').getContext('2d');
  if (_recDashCubIshikawa) _recDashCubIshikawa.destroy();
  _recDashCubIshikawa = new Chart(ctx6, {
    type: 'bar',
    data: { labels: cubIshLabels, datasets: cubIshDS },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { labels: { font: { size: 9 } } } },
      scales: { x: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }, y: { stacked: true } } }
  });
}

var _recUsersCache = [];
var _recCubicadoresCache = [];
async function loadRecUsersDropdown() {
  var res = await fetch('/users/dropdown', { headers: authHeaders() });
  if (!res.ok) return;
  var data = await res.json();
  _recUsersCache = data.users || [];
  // Populate create form responsable
  var createSel = document.getElementById('recResponsable');
  if (createSel) {
    var val = createSel.value;
    createSel.innerHTML = '<option value="">— Sin asignar —</option>';
    _recUsersCache.forEach(function(u) {
      createSel.innerHTML += '<option value="' + u.display + '">' + u.display + ' (' + u.role + ')' + '</option>';
    });
    createSel.value = val;
  }
  // Populate filter responsable
  var filterSel = document.getElementById('recFiltroResponsable');
  if (filterSel) {
    var fval = filterSel.value;
    filterSel.innerHTML = '<option value="">Responsable: Todos</option>';
    _recUsersCache.forEach(function(u) {
      filterSel.innerHTML += '<option value="' + u.display + '">' + u.display + '</option>';
    });
    filterSel.value = fval;
  }
}

async function loadRecCubicadoresDropdown() {
  var res = await fetch('/reclamos/cubicadores', { headers: authHeaders() });
  if (!res.ok) return;
  var data = await res.json();
  _recCubicadoresCache = data.cubicadores || [];
}

function _populateCubicadorSelect(elId, currentVal) {
  var sel = document.getElementById(elId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sin asignar —</option>';
  _recCubicadoresCache.forEach(function(c) {
    sel.innerHTML += '<option value="' + c.email + '">' + c.display + '</option>';
  });
  if (currentVal) sel.value = currentVal;
}

function populateRecFilterProyecto() {
  var src = document.getElementById('recProyecto');
  var dst = document.getElementById('recFiltroProyecto');
  if (!src || !dst) return;
  var fval = dst.value;
  dst.innerHTML = '<option value="">Proyecto: Todos</option>';
  for (var i = 0; i < src.options.length; i++) {
    if (src.options[i].value) {
      dst.innerHTML += '<option value="' + src.options[i].value + '">' + src.options[i].text + '</option>';
    }
  }
  dst.value = fval;
}

async function loadReclamos() {
  var container = document.getElementById('reclamosList');
  var estado = document.getElementById('recFiltroEstado').value;
  var categoria = document.getElementById('recFiltroCategoria').value;
  var aplica = document.getElementById('recFiltroAplica').value;
  var tipo = document.getElementById('recFiltroTipo') ? document.getElementById('recFiltroTipo').value : '';
  var detectado = document.getElementById('recFiltroDetectado') ? document.getElementById('recFiltroDetectado').value : '';
  var proyecto = document.getElementById('recFiltroProyecto') ? document.getElementById('recFiltroProyecto').value : '';
  var responsable = document.getElementById('recFiltroResponsable') ? document.getElementById('recFiltroResponsable').value : '';
  var busqueda = document.getElementById('recFiltroBusqueda') ? document.getElementById('recFiltroBusqueda').value.trim() : '';
  var url = '/reclamos';
  var params = [];
  if (estado) params.push('estado=' + encodeURIComponent(estado));
  if (categoria) params.push('categoria=' + encodeURIComponent(categoria));
  if (aplica) params.push('aplica=' + encodeURIComponent(aplica));
  if (tipo) params.push('tipo_reclamo=' + encodeURIComponent(tipo));
  if (detectado) params.push('detectado_por=' + encodeURIComponent(detectado));
  if (proyecto) params.push('id_proyecto=' + encodeURIComponent(proyecto));
  if (responsable) params.push('responsable=' + encodeURIComponent(responsable));
  if (busqueda) params.push('busqueda=' + encodeURIComponent(busqueda));
  // USC/cubicador/externo only see their own reclamos
  if (['usc','cubicador','externo'].includes(currentRole)) {
    params.push('solo_mios=true');
  }
  if (params.length > 0) url += '?' + params.join('&');

  var res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  
  // Load USC users for assignment dropdowns
  await loadUsuariosUsc();

  if (!data.reclamos || data.reclamos.length === 0) {
    container.innerHTML = '<div class="muted">No hay reclamos con los filtros seleccionados</div>';
    return;
  }

  container.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:5px 6px;">Corr.</th>' +
    '<th style="padding:5px 6px;">Título</th>' +
    '<th style="padding:5px 6px;">Tipo</th>' +
    '<th style="padding:5px 6px;">Proyecto</th>' +
    '<th style="padding:5px 6px;">Detectado</th>' +
    '<th style="padding:5px 6px;">Responsable</th>' +
    '<th style="padding:5px 6px;">Cubicador</th>' +
    '<th style="padding:5px 6px;">Estado</th>' +
    '<th style="padding:5px 6px;">Aplica</th>' +
    '<th style="padding:5px 6px;">Causa</th>' +
    '<th style="padding:5px 6px;">Fecha</th>' +
    '<th style="padding:5px 4px;"></th>' +
    '</tr>' +
    data.reclamos.map(function(r) {
      var eColor = _recEstadoColors[r.estado] || '#666';
      var eLabel = _recEstadoLabels[r.estado] || r.estado;
      var aplLabel = _recAplicaLabels[r.aplica] || 'Pendiente';
      var aplColor = _recAplicaColors[r.aplica] || '#ff9800';
      var tipoLabel = r.tipo_reclamo === 'faltante' ? 'Faltante' : 'Error';
      var tipoColor = r.tipo_reclamo === 'faltante' ? '#ff9800' : '#e53935';
      var causaText = r.cod_causa ? '[' + r.cod_causa + ']' : (r.categoria_ishikawa ? _recIshikawaLabels[r.categoria_ishikawa] : '-');
      var fecha = r.fecha_deteccion || (r.fecha_creacion ? r.fecha_creacion.substring(0, 10) : '');
      var idLabel = r.id_calidad ? r.id_calidad : (r.correlativo || '#' + r.id);
      var idSub = r.id_calidad && r.correlativo ? '<br><span class="muted" style="font-size:9px;">' + r.correlativo + '</span>' : '';
      return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="verReclamo(' + r.id + ')">' +
        '<td style="padding:4px 6px; font-size:11px; font-weight:600;">' + idLabel + idSub + '</td>' +
        '<td style="padding:4px 6px; font-weight:500;">' + r.titulo + '</td>' +
        '<td style="padding:4px 6px;"><span style="color:' + tipoColor + '; font-weight:600; font-size:10px;">' + tipoLabel + '</span></td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.nombre_proyecto || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.detectado_por || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.responsable || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.cubicador_asignado ? r.cubicador_asignado.split('@')[0] : '-') + '</td>' +
        '<td style="padding:4px 6px;"><span style="background:' + eColor + '; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px;">' + eLabel + '</span></td>' +
        '<td style="padding:4px 6px;"><span style="color:' + aplColor + '; font-weight:600; font-size:10px;">' + aplLabel + '</span></td>' +
        '<td style="padding:4px 6px; font-size:11px;" title="' + (r.sub_causa || '') + '">' + causaText + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;" class="muted">' + fecha + '</td>' +
        '<td style="padding:4px 4px;"><button class="secondary" style="font-size:10px; padding:2px 6px;" onclick="event.stopPropagation(); verReclamo(' + r.id + ')">Ver</button></td>' +
        '</tr>';
    }).join('') +
    '</table>' +
    '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + data.reclamos.length + ' reclamo(s)</div>';
}

function limpiarFiltrosReclamos() {
  ['recFiltroBusqueda','recFiltroTipo','recFiltroEstado','recFiltroCategoria','recFiltroAplica','recFiltroDetectado','recFiltroProyecto','recFiltroResponsable'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  loadReclamos();
}

function toggleNuevoReclamo() {
  var form = document.getElementById('nuevoReclamoForm');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function crearReclamo() {
  var titulo = document.getElementById('recTitulo').value.trim();
  var msg = document.getElementById('crearReclamoMsg');
  if (!titulo) { msg.textContent = 'El título es requerido'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Registrando...'; msg.style.color = '#666';

  var body = { titulo: titulo };
  var proyecto = document.getElementById('recProyecto').value;
  var tipoReclamo = document.getElementById('recTipoReclamo').value;
  var responsable = document.getElementById('recResponsable').value;
  var asignadoA = document.getElementById('recAsignadoA').value;
  var descripcion = document.getElementById('recDescripcion').value.trim();
  var detectadoPor = document.getElementById('recDetectadoPor').value;
  var fechaDeteccion = document.getElementById('recFechaDeteccion').value;
  var idCalidad = document.getElementById('recIdCalidad') ? document.getElementById('recIdCalidad').value.trim() : '';
  if (proyecto) body.id_proyecto = proyecto;
  if (tipoReclamo) body.tipo_reclamo = tipoReclamo;
  if (responsable) body.responsable = responsable;
  if (asignadoA) body.asignado_a = asignadoA;
  if (descripcion) body.descripcion = descripcion;
  if (detectadoPor) body.detectado_por = detectadoPor;
  if (fechaDeteccion) body.fecha_deteccion = fechaDeteccion;
  if (idCalidad) body.id_calidad = idCalidad;
  var res = await fetch('/reclamos', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    var label = data.correlativo || ('#' + data.id);
    // Upload staged images (filter nulls from removed previews)
    var filesToUpload = _recCreateStagedFiles.filter(function(f) { return f !== null; });
    if (filesToUpload.length > 0) {
      msg.textContent = label + ' creado. Subiendo ' + filesToUpload.length + ' imagen(es)...'; msg.style.color = '#666';
      for (var i = 0; i < filesToUpload.length; i++) {
        var formData = new FormData();
        formData.append('file', filesToUpload[i]);
        formData.append('tipo', 'antecedente');
        await fetch('/reclamos/' + data.id + '/imagenes', { method: 'POST', headers: authHeaders(), body: formData });
      }
    }
    _recCreateStagedFiles = [];
    msg.textContent = label + ' registrado correctamente'; msg.style.color = '#558B2F';
    ['recTitulo','recDescripcion','recResponsable','recAsignadoA','recDetectadoPor','recFechaDeteccion','recIdCalidad'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('recProyecto').value = '';
    document.getElementById('recCreatePreview').innerHTML = '';
    document.getElementById('recCreateDropMsg').style.display = '';
    document.getElementById('nuevoReclamoForm').style.display = 'none';
    await loadReclamos();
    await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

function toggleNuevoProyectoRec() {
  var form = document.getElementById('nuevoProyectoRecForm');
  if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function crearProyectoDesdeReclamo() {
  var nombre = document.getElementById('recNuevoProjNombre').value.trim();
  var msg = document.getElementById('recNuevoProjMsg');
  if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Creando...'; msg.style.color = '#666';
  var body = { nombre_proyecto: nombre };
  var calculista = document.getElementById('recNuevoProjCalculista').value.trim();
  if (calculista) body.calculista = calculista;
  var res = await fetch('/proyectos', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Obra creada'; msg.style.color = '#558B2F';
    document.getElementById('recNuevoProjNombre').value = '';
    document.getElementById('recNuevoProjCalculista').value = '';
    await loadProyectos();
    await loadFilters();
    var sel = document.getElementById('recProyecto');
    if (sel && data.id_proyecto) sel.value = data.id_proyecto;
    toggleNuevoProyectoRec();
  } else {
    msg.textContent = 'Error: ' + (data.detail || data.error || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function verReclamo(id) {
  var data = await apiGet('/reclamos/' + id);
  if (!data) return;
  _reclamoActual = data;

  document.getElementById('reclamoDetailCard').style.display = '';
  // Reset edit form
  document.getElementById('recEditForm').style.display = 'none';
  document.getElementById('recDetailInfo').style.display = '';
  document.getElementById('btnEditarReclamo').textContent = '✏️ Editar';
  var titlePrefix = data.id_calidad ? data.id_calidad + ' — ' : (data.correlativo ? data.correlativo + ' — ' : '#' + data.id + ' — ');
  document.getElementById('recDetailTitle').textContent = titlePrefix + data.titulo;

  var metaParts = [];
  if (data.correlativo && data.id_calidad) metaParts.push(data.correlativo);
  if (data.nombre_proyecto) metaParts.push('Proyecto: ' + data.nombre_proyecto);
  metaParts.push('Creado por: ' + data.creado_por);
  if (data.fecha_creacion) metaParts.push(data.fecha_creacion.replace('T', ' ').substring(0, 19));
  if (data.responsable) metaParts.push('Responsable: ' + data.responsable);
  if (data.detectado_por) metaParts.push('Detectado por: ' + data.detectado_por);
  if (data.asignado_a) metaParts.push('Subido por: ' + data.asignado_a);
  if (data.cubicador_asignado) metaParts.push('Cubicador: ' + data.cubicador_asignado);
  document.getElementById('recDetailMeta').textContent = metaParts.join(' · ');

  document.getElementById('recDetailEstado').value = data.estado;
  document.getElementById('recDetailAplica').value = data.aplica || 'pendiente';
  var idCalField = document.getElementById('recDetailIdCalidad');
  if (idCalField) idCalField.value = data.id_calidad || '';

  // Populate project dropdown from recProyecto options (already loaded)
  var srcSel = document.getElementById('recProyecto');
  var detSel = document.getElementById('recDetailProyecto');
  if (srcSel && detSel) {
    detSel.innerHTML = srcSel.innerHTML;
    detSel.value = data.id_proyecto || '';
  }

  // Set asignado_a dropdown value
  var detAsignado = document.getElementById('recDetailAsignadoA');
  if (detAsignado) detAsignado.value = data.asignado_a || '';

  // SECTION 1: Antecedentes info
  var info = document.getElementById('recDetailInfo');
  var tipoLabel = data.tipo_reclamo === 'faltante' ? 'Faltante' : 'Error';
  var tipoColor = data.tipo_reclamo === 'faltante' ? '#ff9800' : '#e53935';
  var infoHtml = '<div class="row" style="gap:16px; flex-wrap:wrap;">';
  infoHtml += '<div><strong>Categoría:</strong> <span style="color:' + tipoColor + '; font-weight:600;">' + tipoLabel + '</span></div>';
  infoHtml += '<div><strong>Estado:</strong> <span style="color:' + (_recEstadoColors[data.estado] || '#666') + '; font-weight:600;">' + (_recEstadoLabels[data.estado] || data.estado) + '</span></div>';
  var aplColor = _recAplicaColors[data.aplica] || '#ff9800';
  infoHtml += '<div><strong>Aplica:</strong> <span style="color:' + aplColor + '; font-weight:600;">' + (_recAplicaLabels[data.aplica] || 'Pendiente') + '</span></div>';
  if (data.detectado_por) infoHtml += '<div><strong>Detectado por:</strong> ' + data.detectado_por + '</div>';
  if (data.responsable) infoHtml += '<div><strong>Responsable:</strong> ' + data.responsable + '</div>';
  if (data.kilos_mal_fabricados != null) infoHtml += '<div><strong>Kilos mal fabricados:</strong> <span style="color:#b42318; font-weight:600;">' + data.kilos_mal_fabricados.toLocaleString('es-CL', {minimumFractionDigits: 2}) + ' kg</span></div>';
  if (data.fecha_deteccion) infoHtml += '<div><strong>F. Detección:</strong> ' + data.fecha_deteccion + '</div>';
  if (data.fecha_cierre) infoHtml += '<div><strong>Cerrado:</strong> ' + data.fecha_cierre.replace('T', ' ').substring(0, 19) + '</div>';
  infoHtml += '</div>';
  if (data.descripcion) infoHtml += '<div style="margin-top:6px; white-space:pre-wrap;">' + data.descripcion + '</div>';
  info.innerHTML = infoHtml;

  // SECTION 2: Respuesta del responsable
  var causaDisplay = '';
  if (data.cod_causa && data.sub_causa) {
    causaDisplay = '[' + data.cod_causa + '] ' + (_recIshikawaLabels[data.categoria_ishikawa] || '') + ' > ' + data.sub_causa;
  } else if (data.categoria_ishikawa) {
    causaDisplay = _recIshikawaLabels[data.categoria_ishikawa] || data.categoria_ishikawa;
  }
  document.getElementById('recDetailRespuestaTexto').value = data.respuesta_texto || '';
  document.getElementById('recDetailCausaDisplay').value = causaDisplay;
  document.getElementById('recDetailCategoria').value = data.categoria_ishikawa || '';
  document.getElementById('recDetailSubCausa').value = data.sub_causa || '';
  document.getElementById('recDetailCodCausa').value = data.cod_causa || '';
  document.getElementById('recDetailAreaAplica').value = data.area_aplica || 'Cubicación';
  document.getElementById('recDetailFechaAnalisis').value = data.fecha_analisis || '';
  document.getElementById('recDetailExplicacionCausa').value = data.explicacion_causa || '';
  document.getElementById('recDetailObservaciones').value = data.observaciones || '';
  document.getElementById('recDetailKilosMal').value = data.kilos_mal_fabricados != null ? data.kilos_mal_fabricados : '';
  var respInfo = document.getElementById('recRespuestaInfo');
  if (data.respuesta_por) {
    respInfo.innerHTML = 'Respondido por: <strong>' + data.respuesta_por + '</strong>' +
      (data.respuesta_fecha ? ' — ' + data.respuesta_fecha.replace('T', ' ').substring(0, 19) : '');
  } else {
    respInfo.textContent = 'Sin respuesta aún';
  }
  document.getElementById('recRespMsg').textContent = '';

  // Cubicador asignado dropdown in Section 2
  _populateCubicadorSelect('recDetailCubicadorAsignado', data.cubicador_asignado || '');

  // SECTION 3: Validación
  document.getElementById('recDetailValidacionResultado').value = data.validacion_resultado || '';
  document.getElementById('recDetailValidacionObs').value = data.validacion_observaciones || '';
  var valInfo = document.getElementById('recValidacionInfo');
  if (data.validacion_por) {
    var valLabel = { aprobado: '✅ Aprobado', rechazado: '❌ Rechazado', corregido: '✏️ Corregido' }[data.validacion_resultado] || data.validacion_resultado;
    valInfo.innerHTML = 'Validado por: <strong>' + data.validacion_por + '</strong>' +
      (data.validacion_fecha ? ' — ' + data.validacion_fecha.replace('T', ' ').substring(0, 19) : '') +
      ' — Resultado: <strong>' + valLabel + '</strong>';
  } else {
    valInfo.textContent = 'Sin validación aún';
  }
  document.getElementById('recValidacionMsg').textContent = '';

  // Acciones
  renderAcciones(data.acciones || []);

  // Imagenes split by tipo
  var imgAntecedentes = (data.imagenes || []).filter(function(i) { return i.tipo === 'antecedente' || !i.tipo; });
  var imgRespuesta = (data.imagenes || []).filter(function(i) { return i.tipo === 'respuesta'; });
  renderImagenesEnContainer('recImagenesAntecedentes', imgAntecedentes);
  renderImagenesEnContainer('recImagenesRespuesta', imgRespuesta);

  // Timeline
  renderReclamoTimeline(data.seguimientos || []);

  // Clear seguimiento inputs
  document.getElementById('recSeguimientoComentario').value = '';
  document.getElementById('recSeguimientoEstado').value = '';
  document.getElementById('recSeguimientoMsg').textContent = '';

  // ============ PERMISOS POR ROL ============
  var esCreador = data.creado_por && data.creado_por === currentUserEmail;
  var validado = !!data.validacion_resultado;

  // Edit antecedentes (Sec 1): admin/admin2=any, usc=own
  var puedeEditarSec1 = (currentRole === 'admin' || currentRole === 'admin2') || (currentRole === 'usc' && esCreador);
  if (validado && currentRole !== 'admin') puedeEditarSec1 = false;
  document.getElementById('btnEditarReclamo').style.display = puedeEditarSec1 ? '' : 'none';

  // Aplica: solo admin
  var selAplica = document.getElementById('recDetailAplica');
  selAplica.disabled = (currentRole !== 'admin');

  // Estado: admin/admin2 always, cubicador own only
  var puedeEstado = (currentRole === 'admin' || currentRole === 'admin2') || (currentRole === 'cubicador' && esCreador);
  var selEstado = document.getElementById('recDetailEstado');
  selEstado.disabled = !puedeEstado;

  // Delete: admin/admin2, or usc own
  var puedeEliminar = (currentRole === 'admin' || currentRole === 'admin2') || (currentRole === 'usc' && esCreador);
  document.getElementById('btnEliminarReclamo').style.display = puedeEliminar ? '' : 'none';

  // ID Calidad inline edit: admin/admin2/usc(own)
  var idCalField = document.getElementById('recDetailIdCalidad');
  if (idCalField) idCalField.disabled = !puedeEditarSec1;

  // Proyecto dropdown: admin/admin2
  var detProySel = document.getElementById('recDetailProyecto');
  if (detProySel) detProySel.disabled = !(currentRole === 'admin' || currentRole === 'admin2');

  // Asignado a: admin/admin2 can change assignment
  var detAsigSel = document.getElementById('recDetailAsignadoA');
  if (detAsigSel) detAsigSel.disabled = !(currentRole === 'admin' || currentRole === 'admin2');

  // Cubicador asignado dropdown: admin/admin2 can change
  var puedeCambiarCub = (currentRole === 'admin' || currentRole === 'admin2');
  var detCubSel = document.getElementById('recDetailCubicadorAsignado');
  if (detCubSel) detCubSel.disabled = !puedeCambiarCub;
  var btnCambiarCub = document.getElementById('btnCambiarCubicador');
  if (btnCambiarCub) btnCambiarCub.style.display = puedeCambiarCub ? '' : 'none';

  // Section 2 (Respuesta): admin/admin2/cubicador/externo. NOT usc.
  var puedeResponder = ['admin','admin2','cubicador','externo'].includes(currentRole);
  if (validado && currentRole !== 'admin') puedeResponder = false;
  var sec2Fields = ['recDetailRespuestaTexto','recDetailCausaDisplay','recDetailAreaAplica','recDetailFechaAnalisis','recDetailExplicacionCausa','recDetailObservaciones','recDetailKilosMal'];
  sec2Fields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeResponder; });
  var btnGuardarResp = document.getElementById('btnGuardarRespuesta');
  if (btnGuardarResp) btnGuardarResp.style.display = puedeResponder ? '' : 'none';
  // Respuesta image upload zone
  var respDropZone = document.getElementById('recRespDropZone');
  var respFileInput = document.getElementById('recRespFileInput');
  if (respDropZone) respDropZone.style.display = puedeResponder ? '' : 'none';
  if (respFileInput) respFileInput.disabled = !puedeResponder;

  // Section 3 (Validación): admin/admin2
  var puedeValidar = (currentRole === 'admin' || currentRole === 'admin2');
  var sec3Fields = ['recDetailValidacionResultado','recDetailValidacionObs'];
  sec3Fields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeValidar; });
  var btnGuardarVal = document.getElementById('btnGuardarValidacion');
  if (btnGuardarVal) btnGuardarVal.style.display = puedeValidar ? '' : 'none';

  // Acciones form: admin/admin2/cubicador
  var puedeAccion = ['admin','admin2','cubicador'].includes(currentRole);
  if (validado && currentRole !== 'admin') puedeAccion = false;
  var accionFields = ['recNuevaAccionTipo','recNuevaAccionDesc','recNuevaAccionResp','recNuevaAccionFecha'];
  accionFields.forEach(function(fid) { var el = document.getElementById(fid); if (el) el.disabled = !puedeAccion; });

  document.getElementById('reclamoDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderAcciones(acciones) {
  var container = document.getElementById('recAccionesList');
  if (!acciones || acciones.length === 0) {
    container.innerHTML = '<div class="muted">Sin acciones registradas</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%; border-collapse:collapse;">' +
    '<tr style="background:#fff8e1; text-align:left;">' +
    '<th style="padding:4px 6px;">Tipo</th><th style="padding:4px 6px;">Descripción</th>' +
    '<th style="padding:4px 6px;">Responsable</th><th style="padding:4px 6px;">F. Prevista</th>' +
    '<th style="padding:4px 6px;">Estado</th><th style="padding:4px 4px;"></th></tr>' +
    acciones.map(function(a) {
      var tColor = _recAccionTipoColors[a.tipo] || '#666';
      var eLabel = a.estado === 'completada' ? '✅' : a.estado === 'en_proceso' ? '🔄' : '⏳';
      return '<tr style="border-bottom:1px solid #ffe0b2;">' +
        '<td style="padding:3px 6px;"><span style="color:' + tColor + '; font-weight:600; text-transform:capitalize; font-size:11px;">' + a.tipo + '</span></td>' +
        '<td style="padding:3px 6px;">' + a.descripcion + '</td>' +
        '<td style="padding:3px 6px; font-size:11px;">' + (a.responsable || '-') + '</td>' +
        '<td style="padding:3px 6px; font-size:11px;">' + (a.fecha_prevista || '-') + '</td>' +
        '<td style="padding:3px 6px; font-size:11px;">' + eLabel + ' ' + a.estado + '</td>' +
        '<td style="padding:3px 4px;"><button class="secondary" style="font-size:10px; padding:1px 5px; color:#b42318;" onclick="eliminarAccion(' + a.id + ')">✕</button></td>' +
        '</tr>';
    }).join('') +
    '</table>';
}

function renderImagenesEnContainer(containerId, imagenes) {
  var container = document.getElementById(containerId);
  if (!container) return;
  if (!imagenes || imagenes.length === 0) {
    container.innerHTML = '<div class="muted">Sin imágenes</div>';
    return;
  }
  container.innerHTML = imagenes.map(function(img) {
    return '<div style="position:relative; width:120px; border:1px solid #ccc; border-radius:6px; overflow:hidden; background:#f9f9f9;">' +
      '<a href="' + img.url + '" target="_blank" title="' + img.filename + '">' +
      '<img src="' + img.url + '" style="width:120px; height:90px; object-fit:cover; display:block;" />' +
      '</a>' +
      '<div style="padding:2px 4px; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + img.filename + '</div>' +
      '<button class="secondary" style="position:absolute; top:2px; right:2px; font-size:10px; padding:0 4px; background:rgba(255,255,255,0.8); color:#b42318; border-radius:3px;" onclick="eliminarImagen(' + img.id + ')">✕</button>' +
      '</div>';
  }).join('');
}

function renderReclamoTimeline(seguimientos) {
  var container = document.getElementById('recTimeline');
  if (!seguimientos || seguimientos.length === 0) {
    container.innerHTML = '<div class="muted">Sin seguimientos</div>';
    return;
  }
  container.innerHTML = seguimientos.map(function(s) {
    var fecha = s.fecha ? s.fecha.replace('T', ' ').substring(0, 19) : '';
    var estadoChange = '';
    if (s.estado_nuevo) {
      var fromLabel = _recEstadoLabels[s.estado_anterior] || s.estado_anterior || '?';
      var toLabel = _recEstadoLabels[s.estado_nuevo] || s.estado_nuevo;
      var toColor = _recEstadoColors[s.estado_nuevo] || '#666';
      estadoChange = ' <span style="background:' + toColor + '; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px;">' + fromLabel + ' → ' + toLabel + '</span>';
    }
    return '<div style="padding:6px 0; border-bottom:1px solid #f0f0f0;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<span style="font-weight:500;">' + s.usuario + '</span>' +
      '<span class="muted" style="font-size:10px;">' + fecha + '</span>' +
      '</div>' +
      '<div style="margin-top:2px;">' + (s.comentario || '') + estadoChange + '</div>' +
      '</div>';
  }).join('');
}

// ---- Estado & Aplica ----
async function cambiarEstadoReclamo() {
  if (!_reclamoActual) return;
  var nuevoEstado = document.getElementById('recDetailEstado').value;
  if (nuevoEstado === _reclamoActual.estado) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: nuevoEstado })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); await loadRecLanding(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

function toggleEditarReclamo() {
  var form = document.getElementById('recEditForm');
  var info = document.getElementById('recDetailInfo');
  if (form.style.display === 'none') {
    // Open edit mode — populate fields from current reclamo
    var d = _reclamoActual;
    if (!d) return;
    document.getElementById('recEditTitulo').value = d.titulo || '';
    document.getElementById('recEditTipo').value = d.tipo_reclamo || 'error';
    document.getElementById('recEditFechaDeteccion').value = d.fecha_deteccion || '';
    document.getElementById('recEditIdCalidad').value = d.id_calidad || '';
    document.getElementById('recEditDetectadoPor').value = d.detectado_por || '';
    document.getElementById('recEditDescripcion').value = d.descripcion || '';
    // Populate responsable dropdown from cache
    var sel = document.getElementById('recEditResponsable');
    sel.innerHTML = '<option value="">— Sin asignar —</option>';
    _recUsersCache.forEach(function(u) {
      sel.innerHTML += '<option value="' + u.display + '">' + u.display + ' (' + u.role + ')' + '</option>';
    });
    sel.value = d.responsable || '';
    document.getElementById('recEditMsg').textContent = '';
    form.style.display = '';
    info.style.display = 'none';
    document.getElementById('btnEditarReclamo').textContent = '✕ Cancelar';
  } else {
    form.style.display = 'none';
    info.style.display = '';
    document.getElementById('btnEditarReclamo').textContent = '✏️ Editar';
  }
}

async function guardarEdicionReclamo() {
  if (!_reclamoActual) return;
  var esCreador = _reclamoActual.creado_por && _reclamoActual.creado_por === currentUserEmail;
  var puedeEditar = (currentRole === 'admin' || currentRole === 'admin2') || (currentRole === 'usc' && esCreador);
  if (_reclamoActual.validacion_resultado && currentRole !== 'admin') puedeEditar = false;
  if (!puedeEditar) { alert('No tienes permiso para editar este reclamo.'); return; }
  var msg = document.getElementById('recEditMsg');
  var titulo = document.getElementById('recEditTitulo').value.trim();
  if (!titulo) { msg.textContent = 'El título es obligatorio'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  var body = {
    titulo: titulo,
    descripcion: document.getElementById('recEditDescripcion').value.trim() || null,
    tipo_reclamo: document.getElementById('recEditTipo').value,
    fecha_deteccion: document.getElementById('recEditFechaDeteccion').value || null,
    detectado_por: document.getElementById('recEditDetectadoPor').value || null,
    responsable: document.getElementById('recEditResponsable').value || null,
    id_calidad: document.getElementById('recEditIdCalidad').value.trim() || null,
  };
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Guardado'; msg.style.color = '#558B2F';
    // Close edit form and refresh
    document.getElementById('recEditForm').style.display = 'none';
    document.getElementById('recDetailInfo').style.display = '';
    document.getElementById('btnEditarReclamo').textContent = '✏️ Editar';
    await verReclamo(_reclamoActual.id);
    await loadReclamos();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function guardarIdCalidad() {
  if (!_reclamoActual) return;
  var val = (document.getElementById('recDetailIdCalidad').value || '').trim();
  if (val === (_reclamoActual.id_calidad || '')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_calidad: val })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function cambiarProyectoReclamo() {
  if (!_reclamoActual) return;
  var val = document.getElementById('recDetailProyecto').value;
  if (val === (_reclamoActual.id_proyecto || '')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_proyecto: val || '' })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function cambiarAsignadoAReclamo() {
  if (!_reclamoActual) return;
  var val = document.getElementById('recDetailAsignadoA').value;
  if (val === (_reclamoActual.asignado_a || '')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ asignado_a: val || '' })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function loadUsuariosUsc() {
  var res = await fetch('/reclamos/usuarios-usc', { headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  
  // Update creation form dropdown
  var createSelect = document.getElementById('recAsignadoA');
  if (createSelect) {
    createSelect.innerHTML = '<option value="">— Auto-asignar —</option>';
    data.usuarios.forEach(function(u) {
      var opt = document.createElement('option');
      opt.value = u.email;
      opt.textContent = u.display;
      createSelect.appendChild(opt);
    });
  }
  
  // Update detail form dropdown
  var detailSelect = document.getElementById('recDetailAsignadoA');
  if (detailSelect) {
    detailSelect.innerHTML = '<option value="">— Sin asignar —</option>';
    data.usuarios.forEach(function(u) {
      var opt = document.createElement('option');
      opt.value = u.email;
      opt.textContent = u.display;
      detailSelect.appendChild(opt);
    });
  }
}

async function cambiarAplicaReclamo() {
  if (!_reclamoActual) return;
  var val = document.getElementById('recDetailAplica').value;
  if (val === (_reclamoActual.aplica || 'pendiente')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ aplica: val })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); await loadReclamos(); await loadRecLanding(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// ---- Cambiar cubicador asignado (admin/admin2) ----
async function cambiarCubicadorAsignado() {
  if (!_reclamoActual) return;
  var msg = document.getElementById('recCubicadorMsg');
  var cubVal = document.getElementById('recDetailCubicadorAsignado').value;
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  var body = { cubicador_asignado: cubVal || '' };
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Cubicador actualizado'; msg.style.color = '#558B2F';
    setTimeout(function() { msg.textContent = ''; }, 2000);
    await verReclamo(_reclamoActual.id);
    await loadReclamos();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

// ---- Respuesta del responsable (includes RCA) ----
async function guardarRespuesta() {
  if (!_reclamoActual) return;
  var msg = document.getElementById('recRespMsg');
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  var body = {
    respuesta_texto: document.getElementById('recDetailRespuestaTexto').value.trim() || null,
    categoria_ishikawa: document.getElementById('recDetailCategoria').value || null,
    sub_causa: document.getElementById('recDetailSubCausa').value || null,
    cod_causa: document.getElementById('recDetailCodCausa').value || null,
    area_aplica: document.getElementById('recDetailAreaAplica').value.trim() || null,
    fecha_analisis: document.getElementById('recDetailFechaAnalisis').value || null,
    explicacion_causa: document.getElementById('recDetailExplicacionCausa').value.trim() || null,
    observaciones: document.getElementById('recDetailObservaciones').value.trim() || null,
  };
  var kilosVal = document.getElementById('recDetailKilosMal').value;
  if (kilosVal !== '') body.kilos_mal_fabricados = parseFloat(kilosVal);
  // Admin/admin2: include cubicador_asignado so response is attributed correctly
  if (currentRole === 'admin' || currentRole === 'admin2') {
    var cubVal = document.getElementById('recDetailCubicadorAsignado');
    if (cubVal && cubVal.value) body.cubicador_asignado = cubVal.value;
  }
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Respuesta guardada'; msg.style.color = '#558B2F';
    setTimeout(function() { msg.textContent = ''; }, 2000);
    await verReclamo(_reclamoActual.id);
    await loadReclamos(); await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

// ---- Validación ----
async function guardarValidacion() {
  if (!_reclamoActual) return;
  var msg = document.getElementById('recValidacionMsg');
  var resultado = document.getElementById('recDetailValidacionResultado').value;
  var obs = document.getElementById('recDetailValidacionObs').value.trim();
  if (!resultado) { msg.textContent = 'Selecciona un resultado'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Guardando...'; msg.style.color = '#666';
  var body = {
    validacion_resultado: resultado,
    validacion_observaciones: obs || null,
  };
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Validación guardada'; msg.style.color = '#558B2F';
    setTimeout(function() { msg.textContent = ''; }, 2000);
    await verReclamo(_reclamoActual.id);
    await loadReclamos(); await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

// ---- Acciones ----
async function agregarAccion() {
  if (!_reclamoActual) return;
  var desc = document.getElementById('recNuevaAccionDesc').value.trim();
  if (!desc) { alert('Descripción es requerida'); return; }
  var body = {
    tipo: document.getElementById('recNuevaAccionTipo').value,
    descripcion: desc,
    responsable: document.getElementById('recNuevaAccionResp').value.trim() || null,
    fecha_prevista: document.getElementById('recNuevaAccionFecha').value || null,
  };
  var res = await fetch('/reclamos/' + _reclamoActual.id + '/acciones', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    document.getElementById('recNuevaAccionDesc').value = '';
    document.getElementById('recNuevaAccionResp').value = '';
    document.getElementById('recNuevaAccionFecha').value = '';
    await verReclamo(_reclamoActual.id);
  } else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function eliminarAccion(accionId) {
  if (!_reclamoActual) return;
  if (!confirm('¿Eliminar esta acción?')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id + '/acciones/' + accionId, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// ---- Imágenes: Drop Zone System ----
var _recCreateStagedFiles = [];

function _initDropZone(zoneId, fileInputId, onFiles) {
  var zone = document.getElementById(zoneId);
  var fileInput = document.getElementById(fileInputId);
  if (!zone || !fileInput) return;

  zone.addEventListener('dragover', function(e) {
    e.preventDefault(); e.stopPropagation();
    zone.style.borderColor = '#7b1fa2'; zone.style.background = '#f3e5f5';
  });
  zone.addEventListener('dragleave', function(e) {
    e.preventDefault(); e.stopPropagation();
    zone.style.borderColor = ''; zone.style.background = '';
  });
  zone.addEventListener('drop', function(e) {
    e.preventDefault(); e.stopPropagation();
    zone.style.borderColor = ''; zone.style.background = '';
    var files = [];
    for (var i = 0; i < e.dataTransfer.files.length; i++) {
      if (e.dataTransfer.files[i].type.startsWith('image/')) files.push(e.dataTransfer.files[i]);
    }
    if (files.length) onFiles(files);
  });
  fileInput.addEventListener('change', function() {
    var files = [];
    for (var i = 0; i < fileInput.files.length; i++) files.push(fileInput.files[i]);
    fileInput.value = '';
    if (files.length) onFiles(files);
  });
}

function _initPasteZone(targetElementId, onFiles) {
  document.addEventListener('paste', function(e) {
    var target = document.getElementById(targetElementId);
    if (!target || target.offsetParent === null) return;
    var files = [];
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        var f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) { e.preventDefault(); onFiles(files); }
  });
}

function _addCreatePreview(files) {
  var preview = document.getElementById('recCreatePreview');
  var dropMsg = document.getElementById('recCreateDropMsg');
  if (!preview) return;
  for (var i = 0; i < files.length; i++) {
    _recCreateStagedFiles.push(files[i]);
    var idx = _recCreateStagedFiles.length - 1;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative; display:inline-block;';
    wrap.setAttribute('data-idx', idx);
    var img = document.createElement('img');
    img.style.cssText = 'width:70px; height:70px; object-fit:cover; border-radius:6px; border:1px solid #ddd;';
    img.src = URL.createObjectURL(files[i]);
    var btn = document.createElement('button');
    btn.textContent = '✕';
    btn.style.cssText = 'position:absolute; top:-4px; right:-4px; background:#e53935; color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:11px; cursor:pointer; line-height:18px; padding:0;';
    btn.setAttribute('data-idx', idx);
    btn.onclick = function(ev) {
      ev.stopPropagation();
      var rmIdx = parseInt(this.getAttribute('data-idx'));
      _recCreateStagedFiles[rmIdx] = null;
      this.parentElement.remove();
      var anyLeft = _recCreateStagedFiles.some(function(f) { return f !== null; });
      if (!anyLeft) dropMsg.style.display = '';
    };
    wrap.appendChild(img); wrap.appendChild(btn);
    preview.appendChild(wrap);
  }
  dropMsg.style.display = 'none';
}

async function _uploadFilesWithTipo(files, tipo, msgElId) {
  if (!_reclamoActual) return;
  var msg = document.getElementById(msgElId);
  if (msg) { msg.textContent = 'Subiendo ' + files.length + ' imagen(es)...'; msg.style.color = '#666'; }
  for (var i = 0; i < files.length; i++) {
    var formData = new FormData();
    formData.append('file', files[i]);
    formData.append('tipo', tipo);
    var res = await fetch('/reclamos/' + _reclamoActual.id + '/imagenes', {
      method: 'POST', headers: authHeaders(), body: formData
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (!data.ok) { if (msg) { msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318'; } return; }
  }
  if (msg) { msg.textContent = files.length + ' imagen(es) subida(s)'; msg.style.color = '#558B2F'; setTimeout(function() { msg.textContent = ''; }, 3000); }
  await verReclamo(_reclamoActual.id);
}

function initRecImageDropZones() {
  _initDropZone('recCreateDropZone', 'recCreateFileInput', _addCreatePreview);
  _initDropZone('recDetailDropZone', 'recDetailFileInput', function(files) { _uploadFilesWithTipo(files, 'antecedente', 'recImagenMsg'); });
  _initDropZone('recRespDropZone', 'recRespFileInput', function(files) { _uploadFilesWithTipo(files, 'respuesta', 'recRespImagenMsg'); });
  _initPasteZone('nuevoReclamoForm', _addCreatePreview);
  _initPasteZone('recDetailDropZone', function(files) { _uploadFilesWithTipo(files, 'antecedente', 'recImagenMsg'); });
  _initPasteZone('recRespDropZone', function(files) { _uploadFilesWithTipo(files, 'respuesta', 'recRespImagenMsg'); });
}

async function eliminarImagen(imgId) {
  if (!_reclamoActual) return;
  if (!confirm('¿Eliminar esta imagen?')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id + '/imagenes/' + imgId, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await verReclamo(_reclamoActual.id); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

// ---- Seguimientos ----
async function agregarSeguimiento() {
  if (!_reclamoActual) return;
  var comentario = document.getElementById('recSeguimientoComentario').value.trim();
  var estadoNuevo = document.getElementById('recSeguimientoEstado').value;
  var msg = document.getElementById('recSeguimientoMsg');
  if (!comentario) { msg.textContent = 'Ingresa un comentario'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Agregando...'; msg.style.color = '#666';
  var body = { comentario: comentario };
  if (estadoNuevo) body.estado_nuevo = estadoNuevo;
  var res = await fetch('/reclamos/' + _reclamoActual.id + '/seguimientos', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = '';
    document.getElementById('recSeguimientoComentario').value = '';
    document.getElementById('recSeguimientoEstado').value = '';
    await verReclamo(_reclamoActual.id);
    await loadReclamos();
    await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

async function eliminarReclamo() {
  if (!_reclamoActual) return;
  if (!confirm('¿Eliminar reclamo #' + _reclamoActual.id + ' "' + _reclamoActual.titulo + '"? Esta acción no se puede deshacer.')) return;
  var res = await fetch('/reclamos/' + _reclamoActual.id, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    _reclamoActual = null;
    document.getElementById('reclamoDetailCard').style.display = 'none';
    await loadReclamos();
    await loadRecLanding();
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

// ---- Ishikawa Modal ----
async function abrirIshikawaModal(target) {
  _ishikawaTarget = target || 'create';
  _ishikawaSelection = { categoria: '', sub_causa: '', cod_causa: '' };
  document.getElementById('ishikawaSelectedDisplay').textContent = 'Ninguna';

  if (!_ishikawaData) {
    _ishikawaData = await apiGet('/reclamos/ishikawa');
  }
  if (!_ishikawaData || !_ishikawaData.categorias) return;

  var grid = document.getElementById('ishikawaGrid');
  grid.innerHTML = _ishikawaData.categorias.map(function(cat) {
    var color = _ishikawaCatColors[cat.key] || '#666';
    return '<div style="border:2px solid ' + color + '; border-radius:8px; overflow:hidden;">' +
      '<div style="background:' + color + '; color:#fff; padding:6px 10px; font-weight:600; font-size:13px;">' + cat.label + '</div>' +
      '<div style="padding:6px 8px; max-height:220px; overflow-y:auto;">' +
      cat.subcausas.map(function(sc) {
        return '<label style="display:block; padding:3px 0; font-size:11px; cursor:pointer; line-height:1.3;">' +
          '<input type="radio" name="ishikawa_causa" value="' + cat.key + '|' + sc.cod + '|' + sc.texto + '" ' +
          'onchange="seleccionarIshikawa(this)" style="margin-right:4px;" />' +
          '<strong>[' + sc.cod + ']</strong> ' + sc.texto +
          '</label>';
      }).join('') +
      '</div></div>';
  }).join('');

  document.getElementById('ishikawaModal').style.display = '';
}

function seleccionarIshikawa(radio) {
  var parts = radio.value.split('|');
  _ishikawaSelection = { categoria: parts[0], cod_causa: parts[1], sub_causa: parts[2] };
  var catLabel = _recIshikawaLabels[parts[0]] || parts[0];
  document.getElementById('ishikawaSelectedDisplay').textContent = '[' + parts[1] + '] ' + catLabel + ' > ' + parts[2];
}

function confirmarIshikawa() {
  if (!_ishikawaSelection.categoria) { alert('Selecciona una causa primero'); return; }
  var displayText = '[' + _ishikawaSelection.cod_causa + '] ' + (_recIshikawaLabels[_ishikawaSelection.categoria] || '') + ' > ' + _ishikawaSelection.sub_causa;
  document.getElementById('recDetailCausaDisplay').value = displayText;
  document.getElementById('recDetailCategoria').value = _ishikawaSelection.categoria;
  document.getElementById('recDetailSubCausa').value = _ishikawaSelection.sub_causa;
  document.getElementById('recDetailCodCausa').value = _ishikawaSelection.cod_causa;
  cerrarIshikawaModal();
}

function cerrarIshikawaModal() {
  document.getElementById('ishikawaModal').style.display = 'none';
}

// ESC to close Ishikawa modal
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var modal = document.getElementById('ishikawaModal');
    if (modal && modal.style.display !== 'none') {
      cerrarIshikawaModal();
    }
  }
});

// ========================= INIT =========================
// Track which modules have been loaded to avoid redundant fetches
const _modulesLoaded = {};

async function loadModuleData(mod) {
  if (_modulesLoaded[mod]) return;
  _modulesLoaded[mod] = true;

  if (mod === 'cubicacion') {
    await loadInicio();
    await loadMiActividad();
    await loadProyectos();
    await loadClientes();
    await loadCalculistas();

    const saved = restoreFiltersFromStorage();
    const dep = {};
    if (saved && saved.proyecto) dep.proyecto = saved.proyecto;
    await loadFilters(Object.keys(dep).length ? dep : null);
    if (saved) {
      ['proyecto','plano','sector','piso','ciclo'].forEach(f => {
        const el = document.getElementById(f);
        if (el && saved[f]) el.value = saved[f];
      });
    }

    await loadCargas();
    await loadDashboard('sector');
    await loadSectores();
    await loadPedidos();
    await buscar(true);
  } else if (mod === 'reclamos') {
    await loadProyectos();
    await loadRecUsersDropdown();
    await loadRecCubicadoresDropdown();
    populateRecFilterProyecto();
    await loadReclamos();
    await loadRecLanding();
    initRecImageDropZones();
  } else if (mod === 'admin') {
    await loadUsers();
    await loadClientes();
    await loadCalculistas();
    await loadAdminProyectos();
    await loadTableCounts();
    await loadDbInfo();
    await loadAuditLog();
  }
}

// Override switchModule to also trigger lazy data loading
const _origSwitchModule = switchModule;
switchModule = function(mod) {
  _origSwitchModule(mod);
  if (mod !== 'hub') loadModuleData(mod);
};

// Prevent browser from opening files dropped outside the drop zone
document.addEventListener('dragover', function(e) { e.preventDefault(); });
document.addEventListener('drop', function(e) { e.preventDefault(); });

(async function init() {
  if (!token()) { window.location.href = '/ui/login'; return; }
  await loadMe();
})();
