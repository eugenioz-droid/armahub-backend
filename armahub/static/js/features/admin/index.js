// ========================= ADMIN — Panel principal (E.5) =========================
// loadAdminModule + DB/Tables + Usuarios + Auditoría + Sub-tabs

function switchAdminSubTab(tabId) {
  var panels = ['adminOrganizacion', 'adminConfiguracion', 'adminDatosMaestros', 'adminSistema'];
  panels.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = (id === tabId) ? '' : 'none';
  });
  var btns = document.querySelectorAll('.admin-subtab');
  btns.forEach(function(btn) {
    if (btn.getAttribute('data-subtab') === tabId) {
      btn.classList.add('active');
      btn.style.borderBottomColor = '#1565C0';
      btn.style.color = '#1565C0';
    } else {
      btn.classList.remove('active');
      btn.style.borderBottomColor = 'transparent';
      btn.style.color = '#999';
    }
  });
  if (tabId === 'adminOrganizacion' && typeof loadAreas === 'function') {
    loadAreas();
  }
  if (tabId === 'adminConfiguracion') {
    if (typeof loadCrearReclamoConfig === 'function') loadCrearReclamoConfig();
    if (typeof loadNotifConfig === 'function') loadNotifConfig();
    if (typeof loadRolesPermisos === 'function') loadRolesPermisos();
    if (typeof loadAreaRolPermisos === 'function') loadAreaRolPermisos();
  }
  if (tabId === 'adminDatosMaestros') {
    if (typeof loadClientes === 'function') loadClientes();
    if (typeof loadCalculistas === 'function') loadCalculistas();
    if (typeof loadAdminProyectos === 'function') loadAdminProyectos();
  }
  if (tabId === 'adminSistema') {
    if (typeof loadTableCounts === 'function') loadTableCounts();
    if (typeof loadDbInfo === 'function') loadDbInfo();
    if (typeof loadAuditLog === 'function') loadAuditLog();
    if (currentRole !== 'admin') {
      var resetCard = document.getElementById('adminResetBdCard');
      if (resetCard) resetCard.style.display = 'none';
    }
  }
}

async function loadAdminModule() {
  // Filter role dropdown for admin_calidad
  if (currentRole === 'admin_calidad') {
    var sel = document.getElementById('newUserRole');
    if (sel) {
      Array.from(sel.options).forEach(function(o) {
        if (o.value === 'admin' || o.value === 'admin_calidad') o.remove();
      });
    }
  }
  // Cargar áreas primero para que _areasCache esté disponible al renderizar usuarios
  await loadAreas();
  await loadUsers();
}

// ========================= ADMIN: TABLAS / DB =========================
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
    const canClear = CLEARABLE_TABLES.includes(t.table) && currentRole === 'admin';
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
  const res = await fetch(apiUrl('/admin/tables/' + encodeURIComponent(tableName) + '/clear?confirm=CONFIRMAR'), {
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
  // Hide Reset DB section for admin_calidad
  var resetCard = document.getElementById('adminResetBdCard');
  if (resetCard && currentRole !== 'admin') resetCard.style.display = 'none';
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
  const res = await fetch(apiUrl('/admin/reset-db?' + params.toString()), {
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

// ========================= USUARIOS =========================
var _roleColors = { admin: '#b42318', admin_calidad: '#1565C0', jefe_servicio: '#5e35b1', miembro: '#00897b', cliente: '#7B1FA2', cubicador: '#2e7d32', usc: '#ff9800', externo: '#795548' };
var _roleLabels = { admin: 'Admin', admin_calidad: 'Admin Calidad', cubicador: 'Cubicador (legacy)', usc: 'USC (legacy)', externo: 'Externo', cliente: 'Cliente', miembro: 'Miembro' };

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
  var areaId = document.getElementById('newUserAreaId') ? document.getElementById('newUserAreaId').value : '';
  var rolArea = document.getElementById('newUserRolArea') ? document.getElementById('newUserRolArea').value : 'miembro';
  var msg = document.getElementById('createUserMsg');
  if (!email || !password) { msg.textContent = 'Email y contrasena son requeridos.'; msg.style.color = '#b42318'; return; }
  var params = new URLSearchParams({ email: email, password: password, role: role, nombre: nombre, apellido: apellido });
  if (areaId) { params.append('area_id', areaId); params.append('rol_area', rolArea); }
  var res = await fetch(apiUrl('/auth/register?' + params.toString()), { method: 'POST', headers: authHeaders() });
  var data = await res.json();
  if (!res.ok) { msg.textContent = 'Error: ' + (data.detail || JSON.stringify(data)); msg.style.color = '#b42318'; return; }
  var areaLabel = '';
  if (areaId) {
    var sel = document.getElementById('newUserAreaId');
    var opt = sel ? sel.options[sel.selectedIndex] : null;
    areaLabel = opt ? ' → ' + opt.text + ' (' + rolArea + ')' : '';
  }
  msg.textContent = 'Usuario ' + email + ' (' + role + ')' + areaLabel + ' creado.'; msg.style.color = '#558B2F';
  document.getElementById('newUserEmail').value = '';
  if (document.getElementById('newUserNombre')) document.getElementById('newUserNombre').value = '';
  if (document.getElementById('newUserApellido')) document.getElementById('newUserApellido').value = '';
  document.getElementById('newUserPassword').value = '';
  if (document.getElementById('newUserAreaId')) document.getElementById('newUserAreaId').value = '';
  await loadUsers();
}

async function loadUsers() {
  var container = document.getElementById('usersListContainer');
  if (!container) return;
  var res = await fetch(apiUrl('/admin/users'), { headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  if (!res.ok) { container.innerHTML = '<div class="muted">Error cargando usuarios</div>'; return; }
  var data = await res.json();
  if (!data.users || data.users.length === 0) { container.innerHTML = '<div class="muted">No hay usuarios</div>'; return; }
  var _rolLabels = {admin:'Admin',admin_calidad:'Admin Calidad',jefe_servicio:'Jefe de Servicio',miembro:'Miembro',cliente:'Cliente',cubicador:'Cubicador (legacy)',usc:'USC (legacy)',externo:'Externo'};
  var allRoles = ['admin','admin_calidad','jefe_servicio','miembro','cliente','cubicador','usc','externo'];

  var html = '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
  html += '<tr style="background:#f5f5f5; text-align:left;">';
  html += '<th style="padding:5px 6px;">Email / Nombre</th>';
  html += '<th style="padding:5px 6px;">Rol global</th>';
  html += '<th style="padding:5px 6px;">Áreas asignadas</th>';
  html += '<th style="padding:5px 6px;">Estado</th>';
  html += '<th style="padding:5px 6px;">Acciones</th></tr>';

  data.users.forEach(function(u) {
    var rColor = _roleColors[u.role] || '#666';
    var activo = u.activo !== false;
    var activoBadge = activo
      ? '<span style="color:#2e7d32; font-weight:600; font-size:10px;">Activo</span>'
      : '<span style="color:#b42318; font-weight:600; font-size:10px;">Inactivo</span>';
    var toggleLabel = activo ? 'Desactivar' : 'Activar';
    var toggleColor = activo ? '#b42318' : '#2e7d32';
    var rolOpts = allRoles.map(function(r) {
      return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + (_rolLabels[r] || r) + '</option>';
    }).join('');
    var rowStyle = 'border-bottom:1px solid #eee; vertical-align:top;' + (!activo ? ' background:#fafafa; opacity:0.7;' : '');
    var displayName = ((u.nombre || '') + ' ' + (u.apellido || '')).trim();
    var isProtectedTarget = (u.role === 'admin' || u.role === 'admin_calidad');
    var canOperate = currentRole === 'admin' || (currentRole === 'admin_calidad' && !isProtectedTarget);

    html += '<tr style="' + rowStyle + '">';

    // Email + nombre
    html += '<td style="padding:4px 6px;">';
    html += '<div style="font-weight:500;">' + u.email + '</div>';
    if (displayName) html += '<div class="muted" style="font-size:10px;">' + displayName + '</div>';
    html += '</td>';

    // Rol global — select + botón guardar explícito
    if (canOperate) {
      html += '<td style="padding:4px 6px; white-space:nowrap;">' +
        '<select id="selRolU_' + u.id + '" style="font-size:11px; color:' + rColor + '; font-weight:600; border:1px solid #ddd; border-radius:3px; padding:1px 4px;">' + rolOpts + '</select>' +
        ' <button onclick="guardarRolUsuario(' + u.id + ')" style="font-size:10px; padding:2px 8px; background:#1565C0; color:#fff; border:none; border-radius:3px; cursor:pointer;">Guardar</button>' +
        '</td>';
    } else {
      html += '<td style="padding:4px 6px;"><span style="font-size:11px; color:' + rColor + '; font-weight:600;">' + (_rolLabels[u.role] || u.role) + '</span></td>';
    }

    // Áreas asignadas — select siempre visible, área actual pre-seleccionada
    var areas = u.areas || [];
    var primerArea = areas[0];
    var areaOpts = (typeof _areasCache !== 'undefined' ? _areasCache : [])
      .filter(function(a) { return a.activo; })
      .map(function(a) {
        var sel = (primerArea && primerArea.area_id === a.id) ? ' selected' : '';
        return '<option value="' + a.id + '"' + sel + '>' + a.nombre + '</option>';
      }).join('');
    html += '<td style="padding:4px 6px;">';
    if (canOperate) {
      html += '<div style="display:inline-flex; align-items:center; gap:4px;">' +
        '<select id="selArea_' + u.id + '" data-current="' + (primerArea ? primerArea.area_id : '') + '" style="font-size:11px; padding:2px 4px; border-radius:3px; border:1px solid #ddd; font-weight:' + (primerArea ? '600' : 'normal') + '; color:' + (primerArea ? '#1565C0' : '#555') + ';">' +
        '<option value="">— Sin área —</option>' + areaOpts + '</select>' +
        '<button onclick="asignarAreaInline(' + u.id + ')" style="font-size:11px; padding:2px 8px; background:#1565C0; color:#fff; border:none; border-radius:3px; cursor:pointer;">Guardar</button>' +
        '</div>';
    } else {
      html += '<span style="font-size:11px; color:#1565C0; font-weight:600;">' + (primerArea ? primerArea.area_nombre : '<span class="muted">Sin área</span>') + '</span>';
    }
    html += '</td>';

    // Estado
    html += '<td style="padding:4px 6px;">' + activoBadge + '</td>';

    // Acciones
    html += '<td style="padding:4px 6px; white-space:nowrap;">';
    html += '<button class="secondary" style="font-size:10px; padding:1px 6px;" onclick="editarNombreUsuario(' + u.id + ', \'' + (u.nombre || '').replace(/'/g, "\\'") + '\', \'' + (u.apellido || '').replace(/'/g, "\\'") + '\')">Nombre</button> ';
    if (canOperate) {
      html += '<button class="secondary" style="font-size:10px; padding:1px 6px; color:' + toggleColor + ';" onclick="toggleActivoUsuario(' + u.id + ', ' + !activo + ')">' + toggleLabel + '</button> ';
      html += '<button class="secondary" style="font-size:10px; padding:1px 6px;" onclick="resetPasswordUsuario(' + u.id + ')">Clave</button> ';
      html += '<button class="secondary" style="font-size:10px; padding:1px 6px; color:#b42318;" onclick="eliminarUsuarioAdmin(' + u.id + ')">Eliminar</button>';
    }
    html += '</td></tr>';
  });

  html += '</table>';
  html += '<div class="muted" style="font-size:11px; margin-top:6px;">Total: ' + data.users.length + ' usuario(s)</div>';

  container.innerHTML = html;
}

async function asignarAreaInline(userId) {
  var selArea = document.getElementById('selArea_' + userId);
  if (!selArea) return;
  var areaId = selArea.value;
  // Buscar si ya tiene un área asignada (data-current guardado en el select)
  var areaActual = selArea.getAttribute('data-current');
  // Si eligió "Sin área" y tenía una, quitar
  if (!areaId) {
    if (areaActual) {
      var r = await fetch(apiUrl('/admin/areas/' + areaActual + '/usuarios/' + userId), { method: 'DELETE', headers: authHeaders() });
      if (r.status === 401) { logout(); return; }
      await loadUsers();
    }
    return;
  }
  // Si cambia de área, quitar la anterior primero
  if (areaActual && areaActual !== areaId) {
    await fetch(apiUrl('/admin/areas/' + areaActual + '/usuarios/' + userId), { method: 'DELETE', headers: authHeaders() });
  }
  var res = await fetch(apiUrl('/admin/areas/' + areaId + '/usuarios'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await loadUsers(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function quitarUsuarioDeArea(userId, areaId) {
  if (!confirm('¿Quitar al usuario de esta área?')) return;
  var res = await fetch(apiUrl('/admin/areas/' + areaId + '/usuarios/' + userId), { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await loadUsers(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function guardarRolUsuario(userId) {
  var sel = document.getElementById('selRolU_' + userId);
  if (!sel) return;
  var nuevoRol = sel.value;
  var params = new URLSearchParams({ role: nuevoRol });
  var res = await fetch(apiUrl('/admin/users/' + userId + '/role?' + params.toString()), { method: 'PATCH', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { await loadUsers(); }
  else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function toggleActivoUsuario(userId, nuevoEstado) {
  var params = new URLSearchParams({ activo: nuevoEstado });
  var res = await fetch(apiUrl('/admin/users/' + userId + '/activo?' + params.toString()), { method: 'PATCH', headers: authHeaders() });
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
  var res = await fetch(apiUrl('/admin/users/' + userId + '/password?' + params.toString()), { method: 'PATCH', headers: authHeaders() });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) { alert('Contrasena actualizada'); } else { alert('Error: ' + (data.detail || 'desconocido')); }
}

async function eliminarUsuarioAdmin(userId) {
  if (!confirm('Eliminar este usuario? Esta accion no se puede deshacer.')) return;
  var res = await fetch(apiUrl('/admin/users/' + userId), { method: 'DELETE', headers: authHeaders() });
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
  var res = await fetch(apiUrl('/admin/users/' + userId + '/nombre?' + params.toString()), { method: 'PATCH', headers: authHeaders() });
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
    container.innerHTML = '<div class="muted">No hay registros de auditoría</div>';
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
    '<th style="padding:5px 6px;">Acción</th>' +
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
  let pagHtml = '<span class="muted" style="font-size:11px;">' + data.total + ' registros — Página ' + currentPage + ' de ' + totalPages + '</span>';
  if (_auditOffset > 0) {
    pagHtml += ' <button class="secondary" style="font-size:11px; padding:2px 8px;" onclick="loadAuditLog(' + (_auditOffset - _auditLimit) + ')">← Anterior</button>';
  }
  if (_auditOffset + _auditLimit < data.total) {
    pagHtml += ' <button class="secondary" style="font-size:11px; padding:2px 8px;" onclick="loadAuditLog(' + (_auditOffset + _auditLimit) + ')">Siguiente →</button>';
  }
  pag.innerHTML = pagHtml;
}
