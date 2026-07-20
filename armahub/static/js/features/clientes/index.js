// ArmaHub — Caluga Clientes (5L.11)
// Gestión centralizada de clientes/constructoras: único lugar oficial para
// crear, editar y eliminar. Permisos: admin/admin_calidad/usc pueden entrar;
// editar/eliminar solo el creador o admin (el backend decide y expone
// `puede_modificar` por fila). Eliminar bloqueado si el cliente tiene obras.

(function(global) {
  var _clientesData = [];
  var _puedeGestionar = false;

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function loadClientesModule() {
    var cont = document.getElementById('clientesLista');
    if (!cont) return;
    // Botón "Nuevo cliente" solo para quien puede gestionar (lo confirma el backend).
    cont.innerHTML = '<div class="muted">Cargando clientes...</div>';
    var inactivos = (document.getElementById('cliFiltroInactivos') || {}).checked;
    var url = '/constructoras' + (inactivos ? '' : '?activo=true');
    var data = await apiGet(url);
    if (!data) { cont.innerHTML = '<div class="muted">No fue posible cargar los clientes.</div>'; return; }
    _clientesData = data.constructoras || [];
    _puedeGestionar = !!data.puede_gestionar;
    var btnNuevo = document.getElementById('btnNuevoCliente');
    if (btnNuevo) btnNuevo.style.display = _puedeGestionar ? '' : 'none';
    renderClientesLista();
  }

  function renderClientesLista() {
    var cont = document.getElementById('clientesLista');
    if (!cont) return;
    var busq = ((document.getElementById('cliFiltroBusqueda') || {}).value || '').trim().toLowerCase();
    var rows = _clientesData.filter(function(c) {
      if (!busq) return true;
      var blob = ((c.nombre || '') + ' ' + (c.rut || '') + ' ' + (c.contacto || '')).toLowerCase();
      return blob.indexOf(busq) !== -1;
    });
    if (rows.length === 0) {
      cont.innerHTML = '<div class="muted">No hay clientes con ese filtro.</div>';
      return;
    }
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:5px 6px;">Nombre</th>' +
        '<th style="padding:5px 6px;">RUT</th>' +
        '<th style="padding:5px 6px;">Contacto</th>' +
        '<th style="padding:5px 6px; text-align:right;">Obras</th>' +
        '<th style="padding:5px 6px; text-align:right;">Kilos</th>' +
        '<th style="padding:5px 6px;">Estado</th>' +
        '<th style="padding:5px 4px;"></th>' +
      '</tr>' +
      rows.map(function(c) {
        var acciones = '';
        if (c.puede_modificar) {
          acciones =
            '<button class="secondary" title="Editar" style="font-size:10px; padding:1px 6px; color:#00897b; margin-right:3px;" onclick="event.stopPropagation(); editarCliente(' + c.id + ')">✏️</button>' +
            '<button class="secondary" title="Eliminar" style="font-size:10px; padding:1px 6px; color:#b42318;" onclick="event.stopPropagation(); eliminarCliente(' + c.id + ')">✕</button>';
        }
        var estado = c.activo
          ? '<span style="color:#2e7d32; font-size:11px;">Activo</span>'
          : '<span style="color:#999; font-size:11px;">Inactivo</span>';
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:4px 6px; font-weight:500;">' + _esc(c.nombre) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(c.rut || '-') + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(c.contacto || '-') + '</td>' +
          '<td style="padding:4px 6px; text-align:right;">' + (c.proyectos_count || 0) + '</td>' +
          '<td style="padding:4px 6px; text-align:right; font-size:11px;">' + (typeof formatKilos === 'function' ? formatKilos(c.total_kilos) : (c.total_kilos || 0)) + '</td>' +
          '<td style="padding:4px 6px;">' + estado + '</td>' +
          '<td style="padding:4px 4px; white-space:nowrap; text-align:right;">' + acciones + '</td>' +
          '</tr>';
      }).join('') +
      '</table>' +
      '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' cliente(s)</div>';
  }

  // ---- Modal crear/editar ----
  function abrirModalCliente() {
    _setCliForm({});
    document.getElementById('cliId').value = '';
    document.getElementById('clienteModalTitulo').textContent = 'Nuevo cliente';
    document.getElementById('cliModalMsg').textContent = '';
    document.getElementById('clienteModal').style.display = 'block';
    document.getElementById('cliNombre').focus();
  }

  function editarCliente(id) {
    var c = _clientesData.filter(function(x) { return x.id === id; })[0];
    if (!c) return;
    _setCliForm(c);
    document.getElementById('cliId').value = c.id;
    document.getElementById('clienteModalTitulo').textContent = 'Editar cliente';
    document.getElementById('cliModalMsg').textContent = '';
    document.getElementById('clienteModal').style.display = 'block';
    document.getElementById('cliNombre').focus();
  }

  function _setCliForm(c) {
    document.getElementById('cliNombre').value = c.nombre || '';
    document.getElementById('cliRut').value = c.rut || '';
    document.getElementById('cliContacto').value = c.contacto || '';
    document.getElementById('cliEmail').value = c.email || '';
    document.getElementById('cliTelefono').value = c.telefono || '';
    document.getElementById('cliDireccion').value = c.direccion || '';
    document.getElementById('cliNotas').value = c.notas || '';
  }

  function cerrarModalCliente() {
    document.getElementById('clienteModal').style.display = 'none';
  }

  async function guardarCliente() {
    var msg = document.getElementById('cliModalMsg');
    var id = document.getElementById('cliId').value;
    var nombre = document.getElementById('cliNombre').value.trim();
    if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
    var body = {
      nombre: nombre,
      rut: document.getElementById('cliRut').value.trim() || null,
      contacto: document.getElementById('cliContacto').value.trim() || null,
      email: document.getElementById('cliEmail').value.trim() || null,
      telefono: document.getElementById('cliTelefono').value.trim() || null,
      direccion: document.getElementById('cliDireccion').value.trim() || null,
      notas: document.getElementById('cliNotas').value.trim() || null
    };
    msg.textContent = 'Guardando...'; msg.style.color = '#666';
    var url = id ? ('/constructoras/' + id) : '/constructoras';
    var res = await fetch(apiUrl(url), {
      method: id ? 'PATCH' : 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      cerrarModalCliente();
      if (typeof showToast === 'function') showToast(id ? 'Cliente actualizado' : 'Cliente creado', 'success');
      await loadClientesModule();
      // Refrescar caches de otros módulos que listan clientes (obras, reclamos).
      if (typeof loadClientes === 'function') await loadClientes();
    } else {
      msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
    }
  }

  // ---- Eliminar (con aviso si tiene obras) ----
  async function eliminarCliente(id) {
    var c = _clientesData.filter(function(x) { return x.id === id; })[0];
    var nombre = c ? c.nombre : ('#' + id);
    // Consultar al backend si se puede eliminar y qué obras hay que limpiar.
    var chk = await apiGet('/constructoras/' + id + '/puede-eliminar');
    if (!chk) return;
    if (!chk.puede) {
      if (chk.motivo === 'tiene_obras') {
        var lista = (chk.obras || []).map(function(o) { return '• ' + o.nombre_proyecto; }).join('\n');
        alert('No se puede eliminar "' + nombre + '":\n\n' + chk.mensaje +
              (lista ? '\n\nObras asociadas:\n' + lista : '') +
              '\n\nLimpia estas obras (reasígnalas a otro cliente o elimínalas) desde Cubicación y vuelve a intentar.');
      } else {
        alert(chk.mensaje || 'No se puede eliminar este cliente.');
      }
      return;
    }
    if (!confirm('¿Eliminar el cliente "' + nombre + '"? Esta acción no se puede deshacer.')) return;
    var res = await fetch(apiUrl('/constructoras/' + id), { method: 'DELETE', headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      if (typeof showToast === 'function') showToast('Cliente eliminado', 'success');
      await loadClientesModule();
      if (typeof loadClientes === 'function') await loadClientes();
    } else {
      alert('Error: ' + (data.detail || 'no se pudo eliminar'));
    }
  }

  // Exponer como globales (onclick del HTML + loader del shell)
  global.loadClientesModule = loadClientesModule;
  global.renderClientesLista = renderClientesLista;
  global.abrirModalCliente = abrirModalCliente;
  global.editarCliente = editarCliente;
  global.cerrarModalCliente = cerrarModalCliente;
  global.guardarCliente = guardarCliente;
  global.eliminarCliente = eliminarCliente;
})(window);
