// ========================= ADMIN — Gestión de Áreas =========================
// Panel de administración de áreas del CRM de reclamos/calidad.
// CRUD de áreas + flag tiene_revision + asignación de usuarios por área.
// Base configurable del producto: aquí un cliente define SUS áreas y flujos.

(function(global) {
  'use strict';

  var _areasCache = [];
  var _areaUsuariosActual = null;  // id del área cuyo panel de usuarios está abierto
  var _usersDropdownCache = [];

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
    });
  }

  // ---- Listado de áreas ----
  async function loadAreas() {
    var cont = document.getElementById('areasLista');
    if (!cont) return;
    cont.innerHTML = '<div class="muted">Cargando áreas...</div>';
    loadCrearReclamoConfig();
    var data = await apiGet('/admin/areas');
    if (!data) { cont.innerHTML = '<div class="muted">No se pudieron cargar las áreas.</div>'; return; }
    _areasCache = Array.isArray(data) ? data : [];
    if (_areasCache.length === 0) {
      cont.innerHTML = '<div class="muted">No hay áreas. Crea la primera con "+ Nueva área".</div>';
      return;
    }
    cont.innerHTML =
      '<table style="width:100%; font-size:13px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:6px 8px;">Área</th>' +
        '<th style="padding:6px 8px; text-align:center;">Revisión<br><span style="font-size:10px; font-weight:400; color:#666;">Ext / Int</span></th>' +
        '<th style="padding:6px 8px; text-align:center;">RCA</th>' +
        '<th style="padding:6px 8px; text-align:center;">Usuarios</th>' +
        '<th style="padding:6px 8px;">Estado</th>' +
        '<th style="padding:6px 8px;"></th>' +
      '</tr>' +
      _areasCache.map(function(a) {
        var revExtChecked = a.tiene_revision ? 'checked' : '';
        var revIntChecked = a.tiene_revision_interno ? 'checked' : '';
        var estado = a.activo
          ? '<span style="color:#2e7d32; font-weight:600; font-size:11px;">Activa</span>'
          : '<span style="color:#999; font-size:11px;">Inactiva</span>';
        return '<tr style="border-bottom:1px solid #eee;' + (a.activo ? '' : ' opacity:0.55;') + '">' +
          '<td style="padding:6px 8px; font-weight:500;">' + _esc(a.nombre) +
            ' <span class="muted" style="font-size:10px;">(' + _esc(a.slug) + ')</span></td>' +
          '<td style="padding:6px 8px; text-align:center;">' +
            '<label style="font-size:11px; color:#666; margin-right:6px;" title="Revisión para reclamos de Clientes">Ext <input type="checkbox" ' + revExtChecked +
            ' onchange="toggleAreaRevision(' + a.id + ', \'externo\', this.checked)" /></label>' +
            '<label style="font-size:11px; color:#666;" title="Revisión para reclamos Internos">Int <input type="checkbox" ' + revIntChecked +
            ' onchange="toggleAreaRevision(' + a.id + ', \'interno\', this.checked)" /></label>' +
          '</td>' +
          '<td style="padding:6px 8px; text-align:center; font-size:11px;">' +
            (a.tiene_rca ? (a.total_subcausas + ' sub') : '<span class="muted">—</span>') + '</td>' +
          '<td style="padding:6px 8px; text-align:center;">' +
            '<button class="secondary" style="font-size:11px; padding:2px 8px;" onclick="abrirUsuariosArea(' + a.id + ')">' +
            (a.total_usuarios || 0) + ' 👥</button></td>' +
          '<td style="padding:6px 8px;">' + estado + '</td>' +
          '<td style="padding:6px 8px; white-space:nowrap;">' +
            '<button class="secondary" style="font-size:11px; padding:2px 8px;" onclick="editarArea(' + a.id + ')">Editar</button> ' +
            '<button class="secondary" style="font-size:11px; padding:2px 8px;" onclick="toggleAreaActivo(' + a.id + ')">' +
            (a.activo ? 'Desactivar' : 'Activar') + '</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
      '</table>';
  }

  // ---- Flag tiene_revision (ext) / tiene_revision_interno (int) ----
  async function toggleAreaRevision(areaId, tipo, value) {
    var body = tipo === 'interno'
      ? { tiene_revision_interno: !!value }
      : { tiene_revision: !!value };
    var res = await fetch(apiUrl('/admin/areas/' + areaId + '/revision'), {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) { alert('No se pudo actualizar el flag de revisión.'); await loadAreas(); return; }
    var a = _areasCache.filter(function(x) { return x.id === areaId; })[0];
    if (a) {
      if (tipo === 'interno') a.tiene_revision_interno = !!value;
      else a.tiene_revision = !!value;
    }
  }

  // ---- Crear / editar área ----
  function abrirNuevaArea() {
    document.getElementById('areaEditId').value = '';
    document.getElementById('areaNombreInput').value = '';
    document.getElementById('areaFormMsg').textContent = '';
    document.getElementById('areaFormWrap').style.display = '';
    document.getElementById('areaNombreInput').focus();
  }

  function editarArea(areaId) {
    var a = _areasCache.filter(function(x) { return x.id === areaId; })[0];
    if (!a) return;
    document.getElementById('areaEditId').value = a.id;
    document.getElementById('areaNombreInput').value = a.nombre;
    document.getElementById('areaFormMsg').textContent = '';
    document.getElementById('areaFormWrap').style.display = '';
    document.getElementById('areaNombreInput').focus();
  }

  function cancelarArea() {
    document.getElementById('areaFormWrap').style.display = 'none';
  }

  async function guardarArea() {
    var id = document.getElementById('areaEditId').value;
    var nombre = document.getElementById('areaNombreInput').value.trim();
    var msg = document.getElementById('areaFormMsg');
    if (!nombre) { msg.textContent = 'El nombre es obligatorio'; msg.style.color = '#b42318'; return; }
    msg.textContent = 'Guardando...'; msg.style.color = '#666';
    var url = id ? ('/admin/areas/' + id) : '/admin/areas';
    var method = id ? 'PATCH' : 'POST';
    var res = await fetch(apiUrl(url), {
      method: method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nombre })
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (res.ok && data.ok) {
      document.getElementById('areaFormWrap').style.display = 'none';
      await loadAreas();
    } else {
      msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
    }
  }

  async function toggleAreaActivo(areaId) {
    var a = _areasCache.filter(function(x) { return x.id === areaId; })[0];
    var accion = (a && a.activo) ? 'desactivar' : 'activar';
    if (!confirm('¿Seguro que deseas ' + accion + ' esta área?')) return;
    var res = await fetch(apiUrl('/admin/areas/' + areaId + '/activo'), {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' }
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) { alert('No se pudo cambiar el estado del área.'); return; }
    await loadAreas();
  }

  // ---- Usuarios por área ----
  async function abrirUsuariosArea(areaId) {
    _areaUsuariosActual = areaId;
    var a = _areasCache.filter(function(x) { return x.id === areaId; })[0];
    document.getElementById('areaUsuariosNombre').textContent = a ? a.nombre : ('#' + areaId);
    document.getElementById('areaUsuariosCard').style.display = '';
    document.getElementById('areaUserMsg').textContent = '';
    // Cargar el dropdown de usuarios disponibles (una vez)
    if (_usersDropdownCache.length === 0) {
      var ud = await apiGet('/users/dropdown');
      _usersDropdownCache = (ud && ud.users) ? ud.users : [];
    }
    var sel = document.getElementById('areaUserSelect');
    sel.innerHTML = _usersDropdownCache.map(function(u) {
      return '<option value="' + u.id + '">' + _esc(u.display) + '</option>';
    }).join('');
    await _loadUsuariosArea(areaId);
    document.getElementById('areaUsuariosCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function cerrarUsuariosArea() {
    document.getElementById('areaUsuariosCard').style.display = 'none';
    _areaUsuariosActual = null;
  }

  async function _loadUsuariosArea(areaId) {
    var cont = document.getElementById('areaUsuariosLista');
    cont.innerHTML = '<div class="muted">Cargando...</div>';
    var data = await apiGet('/admin/areas/' + areaId + '/usuarios');
    if (!data) { cont.innerHTML = '<div class="muted">Error al cargar usuarios.</div>'; return; }
    if (data.length === 0) {
      cont.innerHTML = '<div class="muted">Sin usuarios asignados a esta área.</div>';
      return;
    }
    var rolLabels = { miembro: 'Miembro', jefe_servicio: 'Jefe de Servicio' };
    cont.innerHTML =
      '<table style="width:100%; font-size:13px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:5px 8px;">Usuario</th><th style="padding:5px 8px;">Rol en el área</th><th style="padding:5px 8px;"></th></tr>' +
      data.map(function(u) {
        var esJefe = u.rol_area === 'jefe_servicio';
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:5px 8px;">' + _esc(u.nombre) + ' <span class="muted" style="font-size:10px;">' + _esc(u.email) + '</span></td>' +
          '<td style="padding:5px 8px;"><span style="font-size:11px; font-weight:600; color:' + (esJefe ? '#5e35b1' : '#666') + ';">' +
            (rolLabels[u.rol_area] || u.rol_area) + '</span></td>' +
          '<td style="padding:5px 8px;"><button class="secondary" style="font-size:11px; padding:2px 8px; color:#b42318;" ' +
            'onclick="quitarUsuarioArea(' + u.user_id + ')">Quitar</button></td>' +
        '</tr>';
      }).join('') +
      '</table>';
  }

  async function agregarUsuarioArea() {
    if (!_areaUsuariosActual) return;
    var userId = document.getElementById('areaUserSelect').value;
    var rol = document.getElementById('areaUserRol').value;
    var msg = document.getElementById('areaUserMsg');
    if (!userId) { msg.textContent = 'Selecciona un usuario'; msg.style.color = '#b42318'; return; }
    msg.textContent = 'Agregando...'; msg.style.color = '#666';
    var res = await fetch(apiUrl('/admin/areas/' + _areaUsuariosActual + '/usuarios'), {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: parseInt(userId), rol_area: rol })
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (res.ok && data.ok) {
      msg.textContent = '';
      await _loadUsuariosArea(_areaUsuariosActual);
      await loadAreas();  // refresca el conteo de usuarios en la tabla
    } else {
      msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
    }
  }

  async function quitarUsuarioArea(userId) {
    if (!_areaUsuariosActual) return;
    if (!confirm('¿Quitar este usuario del área?')) return;
    var res = await fetch(apiUrl('/admin/areas/' + _areaUsuariosActual + '/usuarios/' + userId), {
      method: 'DELETE',
      headers: { ...authHeaders() }
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) { alert('No se pudo quitar el usuario.'); return; }
    await _loadUsuariosArea(_areaUsuariosActual);
    await loadAreas();
  }

  // ---- Config: quién puede levantar reclamos ----
  var _ROLES_CREAR = [
    { key: 'admin', label: 'Admin' },
    { key: 'admin_calidad', label: 'Admin Calidad' },
    { key: 'usc', label: 'USC' },
    { key: 'cubicador', label: 'Cubicador' },
    { key: 'externo', label: 'Externo' },
    { key: 'miembro', label: 'Miembro' }
  ];
  var _ACCIONES_CREAR = [
    { key: 'externo', label: 'Reclamo externo (cliente)' },
    { key: 'interno', label: 'Reclamo interno (entre áreas)' }
  ];

  async function loadCrearReclamoConfig() {
    var cont = document.getElementById('crearReclamoConfig');
    if (!cont) return;
    var data = await apiGet('/admin/reclamo-crear-config');
    if (!data) { cont.innerHTML = '<div class="muted">No se pudo cargar la configuración.</div>'; return; }
    // Mapa accion|rol → activo
    var map = {};
    data.forEach(function(r) { map[r.accion + '|' + r.rol] = r.activo; });

    var html = '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
    html += '<tr style="background:#f5f5f5; text-align:left;"><th style="padding:6px 8px;">Tipo de reclamo</th>';
    _ROLES_CREAR.forEach(function(rol) {
      html += '<th style="padding:6px 8px; text-align:center; font-size:11px;">' + _esc(rol.label) + '</th>';
    });
    html += '</tr>';
    _ACCIONES_CREAR.forEach(function(acc) {
      html += '<tr style="border-bottom:1px solid #eee;"><td style="padding:6px 8px; font-weight:500;">' + _esc(acc.label) + '</td>';
      _ROLES_CREAR.forEach(function(rol) {
        var activo = !!map[acc.key + '|' + rol.key];
        var bloqueado = (rol.key === 'admin' || rol.key === 'admin_calidad');
        html += '<td style="padding:6px 8px; text-align:center;">' +
          '<input type="checkbox" ' + (activo ? 'checked' : '') + (bloqueado ? ' disabled title="Siempre activo"' : '') +
          ' onchange="toggleCrearReclamoConfig(\'' + acc.key + '\',\'' + rol.key + '\', this.checked)" /></td>';
      });
      html += '</tr>';
    });
    html += '</table>';
    cont.innerHTML = html;
  }

  async function toggleCrearReclamoConfig(accion, rol, activo) {
    var res = await fetch(apiUrl('/admin/reclamo-crear-config'), {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: accion, rol: rol, activo: !!activo })
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) { alert('No se pudo actualizar el permiso.'); await loadCrearReclamoConfig(); }
  }

  // ========================= EXPORTS =========================
  global.loadAreas = loadAreas;
  global.loadCrearReclamoConfig = loadCrearReclamoConfig;
  global.toggleCrearReclamoConfig = toggleCrearReclamoConfig;
  global.toggleAreaRevision = toggleAreaRevision;
  global.abrirNuevaArea = abrirNuevaArea;
  global.editarArea = editarArea;
  global.cancelarArea = cancelarArea;
  global.guardarArea = guardarArea;
  global.toggleAreaActivo = toggleAreaActivo;
  global.abrirUsuariosArea = abrirUsuariosArea;
  global.cerrarUsuariosArea = cerrarUsuariosArea;
  global.agregarUsuarioArea = agregarUsuarioArea;
  global.quitarUsuarioArea = quitarUsuarioArea;

})(window);
