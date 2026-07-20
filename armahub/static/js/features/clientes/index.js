// ArmaHub — Caluga Clientes (5L.11)
// Gestión centralizada de clientes/constructoras: único lugar oficial para
// crear, editar y eliminar. Permisos: admin/admin_calidad/usc pueden entrar;
// editar/eliminar solo el creador o admin (el backend decide y expone
// `puede_modificar` por fila). Eliminar bloqueado si el cliente tiene obras.

(function(global) {
  var _clientesData = [];
  var _puedeGestionar = false;

  // Terminología del "hijo" de cada tipo de cliente (5L.11). Mismo modelo en BD
  // (proyectos.constructora_id), distinto rótulo: constructora→Obra, retail→Sede.
  var _TIPO_LABELS = { constructora: 'Constructora', retail: 'Retail', otro: 'Otro' };
  var _HIJO_LABELS = { constructora: 'Obra', retail: 'Sede', otro: 'Proyecto' };
  var _HIJO_LABELS_PL = { constructora: 'Obras', retail: 'Sedes', otro: 'Proyectos' };
  function _hijoSing(tipo) { return _HIJO_LABELS[tipo] || 'Obra'; }
  function _hijoPlural(tipo) { return _HIJO_LABELS_PL[tipo] || 'Obras'; }

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
        '<th style="padding:5px 6px;">Tipo</th>' +
        '<th style="padding:5px 6px;">RUT</th>' +
        '<th style="padding:5px 6px;">Contacto</th>' +
        '<th style="padding:5px 6px; text-align:right;">Obras/Sedes</th>' +
        '<th style="padding:5px 6px; text-align:right;">Kilos</th>' +
        '<th style="padding:5px 6px;">Estado</th>' +
        '<th style="padding:5px 4px;"></th>' +
      '</tr>' +
      rows.map(function(c) {
        var tipo = c.tipo || 'constructora';
        var acciones = '';
        if (c.puede_modificar) {
          acciones =
            '<button class="secondary" title="Vincular ' + _hijoPlural(tipo).toLowerCase() + '" style="font-size:10px; padding:1px 6px; color:#00897b; margin-right:3px;" onclick="event.stopPropagation(); abrirVincularModal(' + c.id + ')">🔗</button>' +
            '<button class="secondary" title="Editar" style="font-size:10px; padding:1px 6px; color:#00897b; margin-right:3px;" onclick="event.stopPropagation(); editarCliente(' + c.id + ')">✏️</button>' +
            '<button class="secondary" title="Eliminar" style="font-size:10px; padding:1px 6px; color:#b42318;" onclick="event.stopPropagation(); eliminarCliente(' + c.id + ')">✕</button>';
        }
        var estado = c.activo
          ? '<span style="color:#2e7d32; font-size:11px;">Activo</span>'
          : '<span style="color:#999; font-size:11px;">Inactivo</span>';
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:4px 6px; font-weight:500;">' + _esc(c.nombre) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(_TIPO_LABELS[tipo] || tipo) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(c.rut || '-') + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(c.contacto || '-') + '</td>' +
          '<td style="padding:4px 6px; text-align:right;" title="' + _hijoPlural(tipo) + '">' + (c.proyectos_count || 0) + '</td>' +
          '<td style="padding:4px 6px; text-align:right; font-size:11px;">' + (typeof formatKilos === 'function' ? formatKilos(c.total_kilos) : (c.total_kilos || 0)) + '</td>' +
          '<td style="padding:4px 6px;">' + estado + '</td>' +
          '<td style="padding:4px 4px; white-space:nowrap; text-align:right;">' + acciones + '</td>' +
          '</tr>';
      }).join('') +
      '</table>' +
      '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' constructora(s)/cliente(s)</div>';
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
    document.getElementById('cliTipo').value = c.tipo || 'constructora';
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
      tipo: document.getElementById('cliTipo').value || 'constructora',
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

  // ---- Vincular obras/sedes (poblado, 5L.11.10) ----
  var _vincCli = null;              // constructora en edición de vínculos
  var _vincDisponibles = [];        // obras sin constructora (universo cargado)
  var _vincSeleccion = {};          // id_proyecto -> true

  async function abrirVincularModal(id) {
    var c = _clientesData.filter(function(x) { return x.id === id; })[0];
    if (!c) return;
    _vincCli = c;
    _vincSeleccion = {};
    var tipo = c.tipo || 'constructora';
    document.getElementById('vincularModalTitulo').textContent = 'Vincular ' + _hijoPlural(tipo).toLowerCase() + ' — ' + c.nombre;
    document.getElementById('vincularModalSubtitulo').textContent =
      'Marca las ' + _hijoPlural(tipo).toLowerCase() + ' que pertenecen a ' + c.nombre + '. El nombre de la ' + _hijoSing(tipo).toLowerCase() + ' suele empezar con su prefijo.';
    document.getElementById('vincularLabelDisponibles').textContent = _hijoPlural(tipo) + ' sin ' + (tipo === 'retail' ? 'cliente' : 'constructora');
    document.getElementById('vincularBusqueda').value = c.nombre.split(' ')[0] || '';
    document.getElementById('vincularModalMsg').textContent = '';
    document.getElementById('vincularObrasModal').style.display = 'block';
    await _cargarVincular();
  }

  async function _cargarVincular() {
    // Obras ya vinculadas a esta constructora (desde el detalle).
    var det = await apiGet('/constructoras/' + _vincCli.id);
    var tipo = _vincCli.tipo || 'constructora';
    var yaCont = document.getElementById('vincularYaAsignadas');
    if (det && det.proyectos && det.proyectos.length > 0) {
      yaCont.innerHTML = '<div style="font-size:11px; color:#2e7d32; margin-bottom:4px;">Ya vinculadas (' + det.proyectos.length + '):</div>' +
        det.proyectos.map(function(p) {
          return '<div style="font-size:11px; padding:2px 6px; display:flex; justify-content:space-between; align-items:center;">' +
            '<span>✓ ' + _esc(p.nombre_proyecto) + '</span>' +
            '<button class="secondary" title="Desvincular" style="font-size:9px; padding:0 5px; color:#b42318;" onclick="desvincularObra(\'' + _esc(p.id_proyecto) + '\')">✕</button>' +
            '</div>';
        }).join('');
    } else {
      yaCont.innerHTML = '<div class="muted" style="font-size:11px;">Aún no tiene ' + _hijoPlural(tipo).toLowerCase() + ' vinculadas.</div>';
    }
    // Obras sin constructora (para asignar).
    var busq = document.getElementById('vincularBusqueda').value.trim();
    var data = await apiGet('/proyectos-sin-constructora' + (busq ? ('?busqueda=' + encodeURIComponent(busq)) : ''));
    _vincDisponibles = (data && data.obras) || [];
    renderVincularDisponibles();
  }

  function renderVincularDisponibles() {
    var cont = document.getElementById('vincularListaDisponibles');
    if (!cont) return;
    var busq = (document.getElementById('vincularBusqueda').value || '').trim().toLowerCase();
    var rows = _vincDisponibles.filter(function(o) {
      return !busq || (o.nombre_proyecto || '').toLowerCase().indexOf(busq) !== -1;
    });
    if (rows.length === 0) {
      cont.innerHTML = '<div class="muted" style="font-size:12px;">No hay obras sin asignar con ese filtro.</div>';
      return;
    }
    cont.innerHTML = rows.map(function(o) {
      var checked = _vincSeleccion[o.id_proyecto] ? ' checked' : '';
      var kg = (typeof formatKilos === 'function') ? formatKilos(o.kilos) : (o.kilos + ' kg');
      return '<label style="display:flex; align-items:center; gap:8px; padding:3px 4px; font-size:12px; cursor:pointer; border-bottom:1px solid #f5f5f5;">' +
        '<input type="checkbox" data-id="' + _esc(o.id_proyecto) + '"' + checked + ' onchange="_toggleVincSel(this)" />' +
        '<span style="flex:1;">' + _esc(o.nombre_proyecto) + '</span>' +
        '<span class="muted" style="font-size:10px;">' + o.barras + ' barras · ' + kg + '</span>' +
        '</label>';
    }).join('');
  }

  function _toggleVincSel(chk) {
    var id = chk.getAttribute('data-id');
    if (chk.checked) _vincSeleccion[id] = true; else delete _vincSeleccion[id];
  }

  async function confirmarVincularObras() {
    var ids = Object.keys(_vincSeleccion);
    var msg = document.getElementById('vincularModalMsg');
    if (ids.length === 0) { msg.textContent = 'Marca al menos una obra'; msg.style.color = '#b42318'; return; }
    msg.textContent = 'Vinculando...'; msg.style.color = '#666';
    var res = await fetch(apiUrl('/constructoras/' + _vincCli.id + '/vincular-obras'), {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids_proyecto: ids })
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      if (typeof showToast === 'function') showToast(data.vinculadas + ' vinculada(s)', 'success');
      _vincSeleccion = {};
      await _cargarVincular();          // refresca ya-vinculadas y disponibles
      await loadClientesModule();       // refresca el conteo en la tabla
      msg.textContent = '';
    } else {
      msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
    }
  }

  async function desvincularObra(idProyecto) {
    if (!confirm('¿Desvincular esta obra de la constructora?')) return;
    var res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(idProyecto) + '/asignar-constructora'), {
      method: 'POST', headers: authHeaders()
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      await _cargarVincular();
      await loadClientesModule();
    } else {
      alert('Error: ' + (data.detail || 'no se pudo desvincular'));
    }
  }

  function cerrarVincularModal() {
    document.getElementById('vincularObrasModal').style.display = 'none';
    _vincCli = null;
  }

  // Exponer como globales (onclick del HTML + loader del shell)
  global.loadClientesModule = loadClientesModule;
  global.renderClientesLista = renderClientesLista;
  global.abrirModalCliente = abrirModalCliente;
  global.editarCliente = editarCliente;
  global.cerrarModalCliente = cerrarModalCliente;
  global.guardarCliente = guardarCliente;
  global.eliminarCliente = eliminarCliente;
  global.abrirVincularModal = abrirVincularModal;
  global.renderVincularDisponibles = renderVincularDisponibles;
  global._toggleVincSel = _toggleVincSel;
  global.confirmarVincularObras = confirmarVincularObras;
  global.desvincularObra = desvincularObra;
  global.cerrarVincularModal = cerrarVincularModal;
})(window);
