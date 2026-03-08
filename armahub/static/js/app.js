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

// ========================= NEW PROJECT MODAL =========================
let _newProjResolve = null;

async function openNewProjectModal(data) {
  document.getElementById('newProjMsg').textContent = data.mensaje || '';
  document.getElementById('newProjNombre').value = data.proyecto_nombre || '';
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

  const modal = document.getElementById('newProjectModal');
  modal.style.display = 'flex';

  return new Promise(resolve => { _newProjResolve = resolve; });
}

function closeNewProjectModal(confirmed) {
  document.getElementById('newProjectModal').style.display = 'none';
  if (_newProjResolve) {
    if (confirmed) {
      _newProjResolve({
        confirmed: true,
        calculista: document.getElementById('newProjCalculista').value.trim(),
      });
    } else {
      _newProjResolve({ confirmed: false });
    }
    _newProjResolve = null;
  }
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
  btns.forEach(b => { if (b.textContent.includes(tabName === 'inicio' ? 'Inicio' : tabName === 'obras' ? 'Obras' : tabName === 'buscar' ? 'Bar Manager' : tabName === 'dashboards' ? 'Dashboards' : tabName === 'pedidos' ? 'Pedidos' : tabName === 'export' ? 'Exportación' : 'Admin')) b.classList.add('active'); });
}

// ========================= INIT =========================
let currentRole = 'operador';

async function loadMe() {
  const me = await apiGet('/me');
  if (!me) return;
  document.getElementById('whoEmail').textContent = me.email;
  document.getElementById('whoRole').textContent = "Rol: " + me.role;
  localStorage.setItem('armahub_email', me.email);
  currentRole = me.role || 'operador';

  // --- Role-based tab visibility ---
  // Tab button mapping: { tabName: [roles that can see it] }
  // admin sees everything, so no need to list explicitly
  const tabAccess = {
    inicio:     ['admin','coordinador','cubicador','operador','cliente'],
    obras:      ['admin','coordinador','cubicador','operador','cliente'],
    buscar:     ['admin','coordinador','cubicador','operador'],
    dashboards: ['admin','coordinador','cubicador','operador','cliente'],
    pedidos:    ['admin','coordinador','cubicador','operador','cliente'],
    export:     ['admin','coordinador','cubicador','operador'],
    admin:      ['admin']
  };

  // Show/hide tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    const match = onclick.match(/switchTab\('(\w+)'\)/);
    if (match) {
      const tab = match[1];
      const roles = tabAccess[tab] || [];
      btn.style.display = roles.includes(currentRole) ? '' : 'none';
    }
  });

  // Coordinador: hide import section in Obras (they manage, don't import)
  const dropZone = document.getElementById('dropZone');
  const csvFile = document.getElementById('csvFile');
  const importBtn = document.getElementById('importBtn');
  if (currentRole === 'coordinador') {
    if (dropZone) dropZone.style.display = 'none';
    if (csvFile) csvFile.style.display = 'none';
    if (importBtn) importBtn.parentElement.style.display = 'none';
  }

  // Status message
  const roleLabels = {admin:'ADMIN', coordinador:'Coordinador', cubicador:'Cubicador', operador:'Operador', cliente:'Cliente'};
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
    const calcText = p.calculista ? p.calculista : '';
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

  // Populate mover barras selectors & show card if >1 project
  const opts = data.proyectos.map(p => `<option value="${p.id_proyecto}">${p.nombre_proyecto}</option>`).join('');
  document.getElementById('moverOrigen').innerHTML = opts;
  document.getElementById('moverDestino').innerHTML = opts;
  document.getElementById('moverBarrasCard').style.display = data.proyectos.length > 1 ? '' : 'none';
}

// ========================= ADMIN OBRAS =========================
async function crearObra() {
  const name = document.getElementById('newObraName').value.trim();
  const calc = document.getElementById('newObraCalculista').value.trim();
  const msg = document.getElementById('crearObraMsg');
  if (!name) { msg.innerHTML = '<span class="status-err">Ingresa un nombre para la obra</span>'; return; }
  msg.innerHTML = '<span class="muted">Creando...</span>';
  const body = { nombre_proyecto: name };
  if (calc) body.calculista = calc;
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
  const data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/cargas?limit=10');
  if (!data || !data.cargas) { list.innerHTML = '<span class="muted">Error cargando</span>'; return; }
  if (data.cargas.length === 0) {
    list.innerHTML = '<span class="muted">Sin cargas registradas para este proyecto</span>';
    return;
  }
  list.innerHTML = `
    <table style="width:100%; font-size:12px;">
      <thead><tr><th>Archivo</th><th>Plano</th><th>Barras</th><th>Kilos</th><th>Versión</th><th>Usuario</th><th>Fecha</th><th></th></tr></thead>
      <tbody>${data.cargas.map(c => {
        let fecha = '';
        if (c.fecha) {
          const d = new Date(c.fecha);
          fecha = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
        }
        const estadoBadge = c.estado && c.estado !== 'ok' ? '<span style="color:#856404; font-size:10px;">(' + c.estado + ')</span> ' : '';
        return '<tr>' +
          '<td>' + estadoBadge + (c.archivo || '-') + '</td>' +
          '<td>' + (c.plano_code || '-') + '</td>' +
          '<td>' + c.barras_count + '</td>' +
          '<td>' + Math.round(c.kilos || 0).toLocaleString() + ' kg</td>' +
          '<td>' + (c.version_archivo || '-') + '</td>' +
          '<td class="muted">' + c.usuario + '</td>' +
          '<td class="muted">' + fecha + '</td>' +
          '<td><button class="secondary" style="padding:2px 6px; font-size:10px; color:#b42318;" onclick="deleteCarga(' + c.id + ',\'' + idProyecto.replace(/'/g, "&#39;") + '\')">Eliminar</button></td>' +
        '</tr>';
      }).join('')}</tbody>
    </table>`;
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
  const origen = document.getElementById('moverOrigen').value;
  const destino = document.getElementById('moverDestino').value;
  const msg = document.getElementById('moverBarrasMsg');
  if (!origen || !destino) { msg.innerHTML = '<span class="status-err">Selecciona origen y destino</span>'; return; }
  if (origen === destino) { msg.innerHTML = '<span class="status-err">Origen y destino deben ser diferentes</span>'; return; }
  const body = { destino_id: destino };
  const sector = document.getElementById('moverSector').value.trim();
  const piso = document.getElementById('moverPiso').value.trim();
  const ciclo = document.getElementById('moverCiclo').value.trim();
  if (sector) body.sector = sector;
  if (piso) body.piso = piso;
  if (ciclo) body.ciclo = ciclo;
  if (!confirm('Mover barras del proyecto seleccionado al destino. ¿Continuar?')) return;
  msg.innerHTML = '<span class="muted">Moviendo...</span>';
  const res = await fetch('/proyectos/' + encodeURIComponent(origen) + '/mover-barras', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  if (data.ok) {
    msg.innerHTML = '<span class="status-ok">Movidas ' + data.movidas + ' barras</span>';
    await loadProyectos();
    await loadFilters();
    await loadInicio();
    await loadDashboard('sector');
  } else {
    msg.innerHTML = '<span class="status-err">Error: ' + (data.detail || data.message || 'desconocido') + '</span>';
  }
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
  
  function fillSelect(selId, items, isPlanos = false) {
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
      if (isPlanos) {
        o.value = x.code;
        o.textContent = x.nombre || x.code;
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
  
  // Proyectos always full list
  fillSelect('proyecto', data.proyectos);
  fillSelect('exportProyecto', data.proyectos);
  fillSelect('sectorProyectoFilter', data.proyectos);
  fillSelect('matrizProyectoFilter', data.proyectos);
  fillSelect('navProyectoFilter', data.proyectos);
  fillSelect('pedidoProyecto', data.proyectos);
  // Dependent selects
  fillSelect('plano', data.planos, true);
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
    if (data.ok === false && data.new_project) {
      // Proyecto nuevo detectado — mostrar popup para confirmar creación
      const modalResult = await openNewProjectModal(data);
      if (!modalResult.confirmed) {
        results.innerHTML += `<div class="status-warn" style="padding:4px 0; font-size:13px;">⏭️ ${f.name}: creación cancelada</div>`;
        errorCount++;
        continue;
      }
      let retryUrl = '/import/armadetailer?confirmar_nuevo=true';
      if (modalResult.calculista) {
        retryUrl += '&calculista=' + encodeURIComponent(modalResult.calculista);
      }
      const data2 = await apiPostFile(retryUrl, f);
      if (data2 && data2.ok) {
        const kilosText2 = data2.kilos ? ` — ${Math.round(data2.kilos).toLocaleString()} kg` : '';
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.rows_upserted} barras (${data2.proyecto})${kilosText2} (nuevo proyecto)</div>`;
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
        results.innerHTML += `<div class="status-ok" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data2.rows_upserted} barras (${data2.proyecto})${kilosText2} ${choice ? '(reasignado)' : '(nuevo)'}</div>`;
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
    results.innerHTML += `<div class="${statusClass}" style="padding:4px 0; font-size:13px;">✅ ${f.name}: ${data.rows_upserted} barras (${data.proyecto})${kilosText}${validInfo}</div>`;
    if (data.rejected && data.rejected.length > 0) {
      results.innerHTML += `<div class="muted" style="padding:2px 0 4px 20px; font-size:11px;">Rechazadas: ${data.rejected.slice(0,5).join(', ')}</div>`;
    }
    successCount++;
  }

  progress.textContent = `Listo: ${successCount} exitosos, ${errorCount} con error`;
  await setGlobalStatus(`Importación completa: ${successCount}/${total} archivos`, successCount === total ? 'ok' : 'warn');

  pendingFiles = [];
  document.getElementById('csvFile').value = '';
  renderFileList();

  await loadCargas();
  await loadProyectos();
  await loadFilters();
  await loadInicio();
  await loadMiActividad();
  await loadDashboard('sector');
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
        const estadoBadge = c.estado === 'ok' ? '' : `<span class="badge" style="background:#fff3cd; color:#856404; font-size:10px;">${c.estado}</span> `;
        return `<tr>
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
  if (selectedBarras.size === 0) return alert('Selecciona al menos una barra');
  const dest = document.getElementById('accionDestProyecto').value;
  if (!dest) return alert('Selecciona proyecto destino');
  if (!confirm('Mover ' + selectedBarras.size + ' barra(s) al proyecto seleccionado?')) return;
  const res = await apiPostJson('/barras/mover', { id_unicos: Array.from(selectedBarras), destino_id: dest });
  if (res && res.ok) {
    alert('Movidas: ' + res.movidas + ' barras');
    clearSeleccion();
    buscar(true);
    loadProyectos();
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

async function accionCambiarSector() {
  if (selectedBarras.size === 0) return alert('Selecciona al menos una barra');
  const sec = document.getElementById('accionSector').value;
  if (!sec) return alert('Selecciona sector destino');
  if (!confirm('Cambiar sector de ' + selectedBarras.size + ' barra(s) a ' + sec + '?')) return;
  const res = await apiPostJson('/barras/mover', { id_unicos: Array.from(selectedBarras), nuevo_sector: sec });
  if (res && res.ok) {
    alert('Actualizadas: ' + res.movidas + ' barras');
    clearSeleccion();
    buscar(true);
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
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

  document.getElementById('count').textContent = lastTotal.toLocaleString() + ' barras en proyecto';
  document.getElementById('pageInfo').textContent = 'Pág ' + page + '/' + totalPages;

  // Populate toolbar project selector
  const destSel = document.getElementById('accionDestProyecto');
  if (destSel.options.length <= 1) {
    const fd = await apiGet('/filters');
    if (fd && fd.proyectos) {
      fd.proyectos.forEach(p => {
        if (p !== proy) {
          const o = document.createElement('option');
          o.value = p; o.textContent = p;
          destSel.appendChild(o);
        }
      });
    }
  }

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
  hdr += '</tr></thead>';

  // Body
  let body = '<tbody>';
  data.data.forEach(row => {
    const id = row.id_unico;
    const sel = selectedBarras.has(id);
    body += '<tr id="row_' + id.replace(/"/g, '') + '" style="' + (sel ? 'background:#f0f9e8;' : '') + '">';
    body += '<td style="width:28px;"><input type="checkbox" class="barra-cb" data-id="' + id + '" id="cb_' + id.replace(/"/g, '') + '" ' + (sel ? 'checked' : '') + ' onchange="toggleBarra(\'' + id.replace(/'/g, "\\'") + '\')" /></td>';
    DISPLAY_COLS.forEach(c => {
      let val = row[c.key];
      if (c.short) val = shortId(val);
      if (c.fmt) val = c.fmt(row[c.key]);
      body += '<td style="padding:3px 6px;">' + (val != null && val !== '' ? val : '') + '</td>';
    });
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
  const si = document.getElementById('proyectoSearchInput');
  if (si) si.value = '';
  try { localStorage.removeItem(FILTER_STORAGE_KEY); } catch(e) {}
  // Reset toolbar project selector
  const destSel = document.getElementById('accionDestProyecto');
  if (destSel) { destSel.innerHTML = '<option value="">Mover a proyecto...</option>'; }
  selectedBarras.clear();
  updateToolbar();
  loadFilters();
  buscar(true);
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

function _exportDoneKey(proy) { return 'armahub_export_done_' + proy; }

function _getExportDone(proy) {
  try { return JSON.parse(localStorage.getItem(_exportDoneKey(proy)) || '[]'); } catch(e) { return []; }
}
function _setExportDone(proy, arr) {
  try { localStorage.setItem(_exportDoneKey(proy), JSON.stringify(arr)); } catch(e) {}
}

async function previewExport() {
  const proy = document.getElementById('exportProyecto').value;
  const preview = document.getElementById('exportPreview');
  const matrizCard = document.getElementById('exportMatrizCard');
  _exportProy = proy;
  _exportSelected = new Set();
  _exportAllKeys = [];

  if (!proy) {
    preview.innerHTML = '';
    matrizCard.style.display = 'none';
    return;
  }

  preview.innerHTML = '<div class="muted">Cargando...</div>';

  const data = await apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(proy));
  if (!data || !data.items || data.items.length === 0) {
    preview.innerHTML = '<span class="muted">Este proyecto no tiene barras para exportar.</span>';
    matrizCard.style.display = 'none';
    return;
  }

  // Summary
  let totalBarras = 0, totalKilos = 0;
  data.items.forEach(i => { totalBarras += i.barras || 0; totalKilos += i.kilos || 0; });
  preview.innerHTML = '<div style="background:#f8f9fa; padding:12px; border-radius:6px; font-size:13px;">' +
    '<strong>' + totalBarras.toLocaleString() + ' barras</strong> · <strong>' + Math.round(totalKilos).toLocaleString() + ' kg</strong> disponibles para exportar.' +
    '<span class="muted" style="margin-left:8px; font-size:11px;">Un .xlsx por cada combinación SECTOR + PISO + CICLO.</span>' +
    '</div>';

  matrizCard.style.display = 'block';
  buildExportMatriz(data.items, proy);
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

  const TYPE_ORDER = ['LCIELO', 'VCIELO', 'ELEV'];
  const lowestPiso = pisos[pisos.length - 1];

  function getTypesForPiso(piso) {
    const types = [];
    if (piso === lowestPiso) {
      for (const c of ciclos) { if (lookup['FUND|' + piso + '|' + c]) { types.push('FUND'); break; } }
    }
    for (const t of TYPE_ORDER) {
      for (const c of ciclos) { if (lookup[t + '|' + piso + '|' + c]) { types.push(t); break; } }
    }
    for (const s of sectoresSet) {
      if (s === 'FUND' || TYPE_ORDER.includes(s)) continue;
      for (const c of ciclos) { if (lookup[s + '|' + piso + '|' + c]) { types.push(s); break; } }
    }
    return types.length > 0 ? types : ['ELEV'];
  }

  // Load export-done state
  const doneSectors = new Set(_getExportDone(proy));

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

  // Build HTML table
  let html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  // Header row with ciclo names (clickable for column selection)
  html += '<thead><tr>';
  html += '<th style="border:1px solid #ccc; padding:4px 6px; background:#1a1a1a; color:#8BC34A; white-space:nowrap;">Piso</th>';
  ciclos.forEach(c => {
    html += '<th style="border:1px solid #ccc; padding:4px 6px; background:#1a1a1a; color:#8BC34A; text-align:center; white-space:nowrap; cursor:pointer;" onclick="exportToggleCiclo(\'' + c + '\')" title="Click para seleccionar/deseleccionar ' + c + '">' + c + '</th>';
  });
  html += '</tr></thead><tbody>';

  pisos.forEach(piso => {
    const types = getTypesForPiso(piso);
    types.forEach((tipo, typeIdx) => {
      html += '<tr>';
      if (typeIdx === 0) {
        html += '<td rowspan="' + types.length + '" style="border:1px solid #ccc; padding:4px 6px; font-weight:bold; background:#fff; color:#1a1a1a; vertical-align:middle; text-align:center; font-size:12px; white-space:nowrap; cursor:pointer;" onclick="exportTogglePiso(\'' + piso + '\')" title="Click para seleccionar/deseleccionar ' + piso + '">' + piso + '</td>';
      }
      ciclos.forEach(ciclo => {
        const lookupKey = tipo + '|' + piso + '|' + ciclo;
        const exportKey = tipo + '_' + piso + '_' + ciclo;
        const d = lookup[lookupKey];
        if (d) {
          const isDone = doneSectors.has(exportKey);
          const isSelected = _exportSelected.has(exportKey);
          const bg = isDone ? '#e8f5e9' : (isSelected ? '#f3f8ff' : '#fff');
          const border = isSelected ? '2px solid #4285f4' : '1px solid #ccc';
          html += '<td style="border:' + border + '; padding:3px 4px; background:' + bg + '; text-align:center; cursor:pointer; position:relative; transition:all 0.15s;" ';
          html += 'onclick="exportToggleCell(\'' + exportKey + '\')" ';
          html += 'title="' + tipo + ' ' + piso + ' ' + ciclo + ': ' + d.barras + ' barras, ' + Math.round(d.kilos).toLocaleString() + ' kg">';
          // Checkbox visual
          html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' style="position:absolute; top:2px; left:2px; width:12px; height:12px; pointer-events:none; accent-color:#4285f4;" />';
          // Done badge
          if (isDone) {
            html += '<span style="position:absolute; top:1px; right:3px; font-size:10px; color:#558B2F;" title="Ya exportado">✅</span>';
          }
          html += '<div style="font-weight:600; font-size:9px; color:#666; opacity:0.85;">' + tipo + '</div>';
          html += '<div style="font-size:11px; font-weight:bold; color:#1a1a1a;">' + Math.round(d.kilos).toLocaleString() + ' kg</div>';
          html += '<div style="font-size:9px; color:#888;">' + d.barras + ' bar</div>';
          html += '</td>';
        } else {
          html += '<td style="border:1px solid #eee; padding:3px 4px; background:#fff;"></td>';
        }
      });
      html += '</tr>';
    });
  });

  html += '</tbody></table>';

  // Legend
  html += '<div style="margin-top:8px; display:flex; gap:12px; align-items:center; font-size:11px; flex-wrap:wrap;">';
  html += '<span><span style="display:inline-block; width:14px; height:12px; background:#f3f8ff; border:2px solid #4285f4; vertical-align:middle;"></span> Seleccionado</span>';
  html += '<span><span style="display:inline-block; width:14px; height:12px; background:#e8f5e9; border:1px solid #8BC34A; vertical-align:middle;"></span> ✅ Ya exportado</span>';
  html += '<span><span style="display:inline-block; width:14px; height:12px; background:#fff; border:1px solid #ccc; vertical-align:middle;"></span> Pendiente</span>';
  html += '</div>';

  container.innerHTML = html;
  updateExportSelCount();
}

function exportToggleCell(key) {
  if (_exportSelected.has(key)) {
    _exportSelected.delete(key);
  } else {
    _exportSelected.add(key);
  }
  // Re-render matrix to update visuals
  reRenderExportMatriz();
}

function exportTogglePiso(piso) {
  // Get all keys for this piso
  const pisoKeys = _exportAllKeys.filter(k => {
    const parts = k.split('_');
    return parts.length >= 3 && parts[1] === piso;
  });
  // If all are selected, deselect all; otherwise select all
  const allSelected = pisoKeys.every(k => _exportSelected.has(k));
  pisoKeys.forEach(k => { allSelected ? _exportSelected.delete(k) : _exportSelected.add(k); });
  reRenderExportMatriz();
}

function exportToggleCiclo(ciclo) {
  // Get all keys for this ciclo
  const cicloKeys = _exportAllKeys.filter(k => {
    const parts = k.split('_');
    return parts.length >= 3 && parts[parts.length - 1] === ciclo;
  });
  const allSelected = cicloKeys.every(k => _exportSelected.has(k));
  cicloKeys.forEach(k => { allSelected ? _exportSelected.delete(k) : _exportSelected.add(k); });
  reRenderExportMatriz();
}

function exportSelectAll(select) {
  if (select) {
    _exportAllKeys.forEach(k => _exportSelected.add(k));
  } else {
    _exportSelected.clear();
  }
  reRenderExportMatriz();
}

async function reRenderExportMatriz() {
  if (!_exportProy) return;
  const data = await apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(_exportProy));
  if (data && data.items) buildExportMatriz(data.items, _exportProy);
}

function updateExportSelCount() {
  const n = _exportSelected.size;
  const total = _exportAllKeys.length;
  const countEl = document.getElementById('exportSelCount');
  const btn = document.getElementById('exportSelBtn');
  if (countEl) countEl.textContent = n + ' de ' + total + ' seleccionados';
  if (btn) {
    btn.textContent = '📥 Exportar seleccionados (' + n + ')';
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

    // Mark exported sectors as done in localStorage
    const done = new Set(_getExportDone(proy));
    _exportSelected.forEach(k => done.add(k));
    _setExportDone(proy, Array.from(done));

    status.textContent = 'Descarga completada — ' + _exportSelected.size + ' sectores exportados.';
    reRenderExportMatriz();
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

    // Mark ALL sectors as done
    const done = new Set(_getExportDone(proy));
    _exportAllKeys.forEach(k => done.add(k));
    _setExportDone(proy, Array.from(done));

    status.textContent = 'Descarga completada — todos los sectores exportados.';
    reRenderExportMatriz();
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

function limpiarEstadoExport() {
  const proy = _exportProy;
  if (!proy) return;
  if (!confirm('¿Limpiar estado de exportación para este proyecto?')) return;
  try { localStorage.removeItem(_exportDoneKey(proy)); } catch(e) {}
  reRenderExportMatriz();
  const status = document.getElementById('exportStatus');
  if (status) status.textContent = 'Estado de exportación limpiado.';
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
    return '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid #f0f0f0; cursor:pointer;" onclick="openPedido(' + p.id + ')">' +
      '<div>' +
        '<span style="font-weight:600; font-size:13px;">' + (p.titulo || 'Sin título') + '</span>' +
        ' <span class="muted" style="font-size:11px;">#' + p.id + '</span>' +
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

  const res = await apiPostJson('/pedidos', { id_proyecto: proy, titulo: titulo });
  if (res && res.ok) {
    msg.innerHTML = '<span class="status-ok">Pedido #' + res.id + ' creado</span>';
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
  document.getElementById('pedidoDetailMeta').textContent =
    (data.nombre_proyecto || data.id_proyecto) + ' · Creado por ' + (data.creado_por || '—') +
    ' · ' + (data.fecha_creacion || '').substring(0, 10);
  document.getElementById('pedidoDetailEstado').value = data.estado;

  const tbody = document.getElementById('pedidoItemsBody');
  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Sin items — agrega barras arriba</td></tr>';
  } else {
    const estadoItemColors = { pendiente: '#9E9E9E', en_proceso: '#FF9800', completado: '#8BC34A' };
    tbody.innerHTML = data.items.map(i => {
      const ic = estadoItemColors[i.estado] || '#666';
      return '<tr>' +
        '<td style="font-weight:600;">' + i.diam + '</td>' +
        '<td>' + (i.largo || '—') + '</td>' +
        '<td>' + i.cantidad + '</td>' +
        '<td>' + (i.sector || '—') + '</td>' +
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
  const diam = parseFloat(document.getElementById('itemDiam').value);
  const largo = parseFloat(document.getElementById('itemLargo').value) || null;
  const cantidad = parseInt(document.getElementById('itemCant').value) || 1;
  const sector = document.getElementById('itemSector').value || null;
  const nota = document.getElementById('itemNota').value.trim() || null;
  const msg = document.getElementById('pedidoDetailMsg');

  if (!diam || isNaN(diam)) { msg.innerHTML = '<span class="status-err">Ingresa diámetro</span>'; return; }

  const res = await apiPostJson('/pedidos/' + _pedidoActual + '/items', {
    diam, largo, cantidad, sector, nota
  });
  if (res && res.ok) {
    document.getElementById('itemDiam').value = '';
    document.getElementById('itemLargo').value = '';
    document.getElementById('itemCant').value = '1';
    document.getElementById('itemSector').value = '';
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

// ========================= ADMIN =========================
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

async function createUser() {
  const email = document.getElementById('newUserEmail').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  const msg = document.getElementById('createUserMsg');

  if (!email || !password) {
    msg.textContent = 'Email y contraseña son requeridos.';
    msg.className = 'status-err';
    return;
  }

  const params = new URLSearchParams({ email, password, role });
  const res = await fetch('/auth/register?' + params.toString(), {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json();

  if (!res.ok) {
    msg.textContent = 'Error: ' + (data.detail || JSON.stringify(data));
    msg.className = 'status-err';
    return;
  }

  msg.textContent = `Usuario ${email} (${role}) creado exitosamente.`;
  msg.className = 'status-ok';
  document.getElementById('newUserEmail').value = '';
  document.getElementById('newUserPassword').value = '';
}

// ========================= INIT =========================
(async function init() {
  if (!token()) { window.location.href = '/ui/login'; return; }
  await loadMe();
  await loadInicio();
  await loadMiActividad();
  await loadProyectos();

  // Restore saved filters from localStorage
  const saved = restoreFiltersFromStorage();
  const dep = {};
  if (saved && saved.proyecto) dep.proyecto = saved.proyecto;
  await loadFilters(Object.keys(dep).length ? dep : null);
  // Now set saved select values after options are populated
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
})();
