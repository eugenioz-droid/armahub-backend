// ========================= ADMIN — Proyectos (E.5) =========================
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
  html += '<th style="padding:5px 6px;">Constructora</th>';
  html += '<th style="padding:5px 6px;">Barras</th>';
  html += '<th style="padding:5px 6px;">Kilos</th>';
  html += '<th style="padding:5px 6px;">Creador</th>';
  html += '<th style="padding:5px 6px;">Acciones</th></tr>';

  _adminProyectosCache.forEach(function(p) {
    var kilos = p.total_kilos ? Math.round(p.total_kilos).toLocaleString('es-CL') : '0';
    var calc = p.calculista_nombre || '<span class="muted">-</span>';
    var cliente = p.constructora_nombre || '<span class="muted">-</span>';
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
    var cdata = await apiGet('/constructoras');
    clienteData = (cdata && cdata.constructoras) ? cdata.constructoras : [];
  } catch(e) {}
  var clienteOpts = '<option value="0">— Sin constructora —</option>' +
    clienteData.map(function(c) {
      return '<option value="' + c.id + '"' + (c.id === p.constructora_id ? ' selected' : '') + '>' + c.nombre + '</option>';
    }).join('');

  var formHtml = '<div style="padding:12px; background:#e3f2fd; border:1px solid #90caf9; border-radius:8px; margin-bottom:10px;">';
  formHtml += '<h4 style="margin:0 0 10px 0; color:#1565C0; font-size:13px;">Editando: ' + p.nombre_proyecto + '</h4>';
  formHtml += '<div class="row" style="gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:6px;">';
  formHtml += '<div class="col" style="flex:2; min-width:200px;"><label style="font-size:11px; color:#666;">Nombre del proyecto *</label>';
  formHtml += '<input type="text" id="editProjNombre" value="' + (p.nombre_proyecto || '').replace(/"/g, '&quot;') + '" style="width:100%; font-size:12px;" /></div>';
  formHtml += '</div>';
  formHtml += '<div class="row" style="gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:6px;">';
  formHtml += '<div class="col" style="flex:1; min-width:180px;"><label style="font-size:11px; color:#666;">Calculista</label>';
  formHtml += '<div style="display:flex; gap:4px;"><select id="editProjCalculista" style="flex:1; font-size:12px;">' + calcOpts + '</select>';
  formHtml += '<button class="secondary" style="font-size:11px; padding:2px 7px; white-space:nowrap;" onclick="toggleAdminProjNewCalc()">+ Nuevo</button></div>';
  formHtml += '<div id="adminProjNewCalcForm" style="display:none; margin-top:3px; padding:5px; background:#fff; border-radius:4px;"><div style="display:flex; gap:3px;">';
  formHtml += '<input type="text" id="adminProjNewCalcNombre" placeholder="Nombre calculista" style="flex:1; font-size:11px;" />';
  formHtml += '<button onclick="crearCalcDesdeAdminProj()" style="font-size:10px; padding:2px 7px;">Crear</button></div>';
  formHtml += '<span id="adminProjNewCalcMsg" style="font-size:10px;"></span></div></div>';
  formHtml += '<div class="col" style="flex:1; min-width:180px;"><label style="font-size:11px; color:#666;">Constructora</label>';
  formHtml += '<div style="display:flex; gap:4px;"><select id="editProjCliente" style="flex:1; font-size:12px;">' + clienteOpts + '</select>';
  formHtml += '<button class="secondary" style="font-size:11px; padding:2px 7px; white-space:nowrap;" onclick="toggleAdminProjNewConst()">+ Nueva</button></div>';
  formHtml += '<div id="adminProjNewConstForm" style="display:none; margin-top:3px; padding:5px; background:#fff; border-radius:4px;"><div style="display:flex; gap:3px;">';
  formHtml += '<input type="text" id="adminProjNewConstNombre" placeholder="Nombre constructora" style="flex:1; font-size:11px;" />';
  formHtml += '<button onclick="crearConstDesdeAdminProj()" style="font-size:10px; padding:2px 7px;">Crear</button></div>';
  formHtml += '<span id="adminProjNewConstMsg" style="font-size:10px;"></span></div></div>';
  formHtml += '</div>';
  formHtml += '<div style="margin-bottom:8px;"><label style="font-size:11px; color:#666;">Descripción</label>';
  formHtml += '<textarea id="editProjDescripcion" rows="2" style="width:100%; font-size:12px; resize:vertical;">' + (p.descripcion || '') + '</textarea></div>';
  // Usuarios autorizados section
  formHtml += '<div style="padding:8px; background:#fff; border-radius:6px; margin-bottom:8px;">';
  formHtml += '<div style="font-size:11px; font-weight:600; margin-bottom:5px;">Usuarios autorizados</div>';
  formHtml += '<div id="adminProjAutorizadosList" class="muted" style="font-size:11px; min-height:16px; margin-bottom:6px;">Cargando...</div>';
  formHtml += '<div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">';
  formHtml += '<select id="adminProjUserSel" style="flex:2; min-width:130px; font-size:11px;"><option>Cargando...</option></select>';
  formHtml += '<select id="adminProjUserRol" style="width:100px; font-size:11px;">';
  formHtml += '<option value="admin">Admin</option><option value="cubicador" selected>Cubicador</option>';
  formHtml += '<option value="usc">USC</option><option value="externo">Externo</option><option value="cliente">Cliente</option></select>';
  formHtml += '<button onclick="autorizarUsuarioAdminProj(\'' + p.id_proyecto + '\')" style="font-size:10px; padding:3px 8px;">+ Agregar</button>';
  formHtml += '</div></div>';
  formHtml += '<div style="display:flex; gap:6px; align-items:center;">';
  formHtml += '<button onclick="guardarProyectoAdmin(\'' + p.id_proyecto + '\')" style="font-size:11px; padding:4px 14px;">💾 Guardar</button>';
  formHtml += '<button class="secondary" onclick="loadAdminProyectos()" style="font-size:11px; padding:4px 10px;">Cancelar</button>';
  formHtml += '<span id="editProjMsg" class="muted" style="font-size:11px;"></span>';
  formHtml += '</div></div>';

  // Prepend form above the table
  container.insertAdjacentHTML('afterbegin', formHtml);
  document.getElementById('editProjNombre').focus();

  // Load users and autorizados
  var userSel = document.getElementById('adminProjUserSel');
  var usersData = await apiGet('/users/list');
  if (usersData && usersData.users) {
    userSel.innerHTML = usersData.users.map(function(u) {
      var label = [u.nombre, u.apellido].filter(Boolean).join(' ');
      return '<option value="' + u.id + '">' + (label ? label + ' (' + u.email + ')' : u.email) + '</option>';
    }).join('');
  }
  await loadAutorizadosAdminProj(p.id_proyecto);
}

async function loadAutorizadosAdminProj(idProyecto) {
  var list = document.getElementById('adminProjAutorizadosList');
  if (!list) return;
  var data = await apiGet('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizados');
  if (!data || !data.autorizados) { list.innerHTML = '<span class="muted">Error</span>'; return; }
  if (data.autorizados.length === 0) { list.innerHTML = '<span class="muted">Sin usuarios autorizados</span>'; return; }
  var rolColors = {admin:'#1565C0', usc:'#FF9800', cubicador:'#8BC34A', externo:'#9C27B0', cliente:'#607D8B'};
  list.innerHTML = data.autorizados.map(function(a) {
    var nombre = [a.nombre, a.apellido].filter(Boolean).join(' ');
    var display = nombre ? nombre + ' (' + a.email + ')' : a.email;
    var rc = rolColors[a.rol] || '#666';
    return '<div style="display:inline-flex; align-items:center; gap:4px; margin:1px 4px 1px 0;">' +
      '<span style="font-size:10px; padding:1px 5px; border-radius:3px; background:' + rc + '22; color:' + rc + '; font-weight:600;">' + a.rol.toUpperCase() + '</span>' +
      '<span style="font-size:11px;">' + display + '</span>' +
      '<button class="secondary" style="font-size:9px; padding:0px 4px; color:#b42318; border-color:#b42318;" onclick="revocarUsuarioAdminProj(\'' + idProyecto + '\',' + a.user_id + ')">&#10005;</button>' +
      '</div>';
  }).join('');
}

async function autorizarUsuarioAdminProj(idProyecto) {
  var userId = parseInt(document.getElementById('adminProjUserSel').value);
  var rol = document.getElementById('adminProjUserRol').value;
  if (!userId) return;
  var res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, rol: rol })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    await loadAutorizadosAdminProj(idProyecto);
  } else {
    var msg = document.getElementById('editProjMsg');
    if (msg) { msg.textContent = data.detail || 'Error'; msg.style.color = '#b42318'; }
  }
}

async function revocarUsuarioAdminProj(idProyecto, userId) {
  if (!confirm('\u00bfRevocar acceso?')) return;
  var res = await fetch('/proyectos/' + encodeURIComponent(idProyecto) + '/autorizar/' + userId, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) await loadAutorizadosAdminProj(idProyecto);
}

function toggleAdminProjNewCalc() {
  var f = document.getElementById('adminProjNewCalcForm');
  if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearCalcDesdeAdminProj() {
  var nombre = document.getElementById('adminProjNewCalcNombre').value.trim();
  var msg = document.getElementById('adminProjNewCalcMsg');
  if (!nombre) { msg.textContent = 'Ingresa un nombre'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Creando...'; msg.style.color = '#666';
  var res = await fetch('/calculistas', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: nombre })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Creado'; msg.style.color = '#558B2F';
    document.getElementById('adminProjNewCalcNombre').value = '';
    await loadCalculistas();
    var sel = document.getElementById('editProjCalculista');
    if (sel) {
      sel.innerHTML = '<option value="0">\u2014 Sin calculista \u2014</option>' +
        _calculistasCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
      sel.value = data.id;
    }
    document.getElementById('adminProjNewCalcForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

function toggleAdminProjNewConst() {
  var f = document.getElementById('adminProjNewConstForm');
  if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function crearConstDesdeAdminProj() {
  var nombre = document.getElementById('adminProjNewConstNombre').value.trim();
  var msg = document.getElementById('adminProjNewConstMsg');
  if (!nombre) { msg.textContent = 'Ingresa un nombre'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Creando...'; msg.style.color = '#666';
  var res = await fetch('/constructoras', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: nombre })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = 'Creada'; msg.style.color = '#558B2F';
    document.getElementById('adminProjNewConstNombre').value = '';
    await loadClientes();
    var sel = document.getElementById('editProjCliente');
    if (sel) {
      sel.innerHTML = '<option value="0">\u2014 Sin constructora \u2014</option>' +
        _clientesCache.map(function(c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
      sel.value = data.id;
    }
    document.getElementById('adminProjNewConstForm').style.display = 'none';
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
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
    constructora_id: parseInt(document.getElementById('editProjCliente').value) || 0,
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
