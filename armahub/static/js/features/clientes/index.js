// ArmaHub — Caluga Clientes (5L.11)
// Dos sub-tabs: "Obras / Tiendas" (primario) y "Empresas" (secundario).
// - La OBRA (proyectos) es el registro de trabajo; se le completa su clasificación
//   (obra/tienda/otro), su EMPRESA (referencia a la tabla constructoras) y demás data.
// - La EMPRESA es una entidad propia (constructoras): nombre, RUT, contacto, etc.
// Optimistic update tras guardar (SPECS §2.4): no recargar todo del servidor.

(function(global) {
  var _obrasData = [];
  var _empresasData = [];        // entidades empresa (tabla constructoras)
  var _calculistasCache = [];
  var _cliSubActual = 'obras';

  var _CLASIF_LABELS = { obra: 'Obra', tienda: 'Tienda', otro: 'Otro' };
  var _TIPO_EMP_LABELS = { constructora: 'Constructora', retail: 'Retail', otro: 'Otro' };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _kg(v) { return (typeof formatKilos === 'function') ? formatKilos(v) : ((v || 0) + ' kg'); }
  // Crear obra (POST /proyectos) es admin/admin_calidad only — igual que el backend.
  function _puedeCrearObra() {
    return (typeof currentRole !== 'undefined') && (currentRole === 'admin' || currentRole === 'admin_calidad');
  }
  function _empNombre(id) {
    var e = _empresasData.filter(function(x) { return x.id === id; })[0];
    return e ? e.nombre : null;
  }
  // El detail de FastAPI puede ser string (HTTPException) o array de objetos
  // (validación Pydantic 422). Concatenar el array daba "[object Object]". Este
  // helper lo formatea de forma legible en ambos casos.
  function _errDetail(data) {
    var d = data && data.detail;
    if (!d) return 'desconocido';
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      return d.map(function(x) {
        if (x && x.msg) {
          var campo = (x.loc && x.loc.length) ? x.loc[x.loc.length - 1] : '';
          return (campo ? (campo + ': ') : '') + x.msg;
        }
        return (typeof x === 'string') ? x : JSON.stringify(x);
      }).join(' · ');
    }
    return (typeof d === 'object') ? JSON.stringify(d) : String(d);
  }

  // ---- Carga + navegación de sub-tabs ----
  async function loadClientesModule() {
    // Carga ambos datasets (obras + empresas) una vez; los sub-tabs solo cambian vista.
    await Promise.all([_cargarEmpresas(), _cargarObras(), _cargarCalculistas()]);
    switchCliSubTab(_cliSubActual);
  }

  var _SUB_COLORS = { obras: '#00897b', empresas: '#00897b', calculistas: '#5e35b1' };

  function switchCliSubTab(sub) {
    _cliSubActual = sub;
    var panels = { obras: 'cliSubObras', empresas: 'cliSubEmpresas', calculistas: 'cliSubCalculistas' };
    var btns = { obras: 'cliSubBtnObras', empresas: 'cliSubBtnEmpresas', calculistas: 'cliSubBtnCalculistas' };
    Object.keys(panels).forEach(function(k) {
      var p = document.getElementById(panels[k]);
      if (p) p.style.display = (k === sub) ? '' : 'none';
      var b = document.getElementById(btns[k]);
      if (b) {
        b.style.borderBottomColor = (k === sub) ? (_SUB_COLORS[sub] || '#00897b') : 'transparent';
        b.style.color = (k === sub) ? (_SUB_COLORS[sub] || '#00897b') : '#999';
      }
    });
    if (sub === 'obras') renderObrasLista();
    else if (sub === 'empresas') renderEmpresasLista();
    else renderCalculistasLista();
  }

  async function _cargarObras() {
    var data = await apiGet('/proyectos');
    _obrasData = (data && data.proyectos) || [];
  }
  var _clientesAsa = [], _clientesSueltas = [], _cliAbierto = null;
  async function _cargarEmpresas() {
    var data = await apiGet('/constructoras');
    _empresasData = (data && data.constructoras) || [];
    // LA VISTA DE aSa (13-oct): lo que existe de verdad son los clientes de aSa; las
    // constructoras son su complemento.
    var asa = await apiGet('/clientes/asa');
    _clientesAsa = (asa && asa.clientes) || [];
    _clientesSueltas = (asa && asa.sin_nombre_asa) || [];
  }
  async function _cargarCalculistas() {
    var data = await apiGet('/calculistas?activo=true');
    _calculistasCache = (data && data.calculistas) || [];
  }

  // ======================= SUB-TAB OBRAS / TIENDAS =======================
  function _poblarFiltroEmpresaObras() {
    var sel = document.getElementById('cliFiltroEmpresa');
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">Empresa: Todas</option>' +
      _empresasData.map(function(e) { return '<option value="' + e.id + '">' + _esc(e.nombre) + '</option>'; }).join('');
    sel.value = prev;
  }

  function renderObrasLista() {
    var cont = document.getElementById('obrasLista');
    if (!cont) return;
    _poblarFiltroEmpresaObras();
    var busq = ((document.getElementById('cliFiltroBusqueda') || {}).value || '').trim().toLowerCase();
    var fClasif = (document.getElementById('cliFiltroClasif') || {}).value || '';
    var fEmpresa = (document.getElementById('cliFiltroEmpresa') || {}).value || '';
    var fSinEmpresa = (document.getElementById('cliFiltroSinEmpresa') || {}).checked;

    var rows = _obrasData.filter(function(o) {
      var clasif = o.clasificacion || 'obra';
      var empNom = o.constructora_nombre || '';
      if (fClasif && clasif !== fClasif) return false;
      if (fEmpresa && String(o.constructora_id) !== String(fEmpresa)) return false;
      if (fSinEmpresa && o.constructora_id) return false;
      if (busq) {
        var blob = ((o.nombre_proyecto || '') + ' ' + empNom).toLowerCase();
        if (blob.indexOf(busq) === -1) return false;
      }
      return true;
    });

    var sinEmpresa = _obrasData.filter(function(o) { return !o.constructora_id; }).length;
    var resumenEl = document.getElementById('cliResumen');
    if (resumenEl) resumenEl.textContent = _obrasData.length + ' obras · ' + sinEmpresa + ' sin empresa';

    if (rows.length === 0) {
      cont.innerHTML = '<div class="muted">No hay obras con ese filtro.</div>';
      return;
    }
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:5px 6px;">Obra / Tienda</th>' +
        '<th style="padding:5px 6px;">Clasificación</th>' +
        '<th style="padding:5px 6px;">Empresa</th>' +
        '<th style="padding:5px 6px;">Calculista</th>' +
        '<th style="padding:5px 6px; text-align:right;">Barras</th>' +
        '<th style="padding:5px 6px; text-align:right;">Kilos</th>' +
        '<th style="padding:5px 6px; text-align:right;">Reclamos</th>' +
        '<th style="padding:5px 4px;"></th>' +
      '</tr>' +
      rows.map(function(o) {
        var clasif = o.clasificacion || 'obra';
        var empresa = o.constructora_nombre
          ? _esc(o.constructora_nombre)
          : '<span style="color:#e65100; font-style:italic;">— sin empresa —</span>';
        var recBadge = o.n_reclamos > 0
          ? '<span style="display:inline-block; min-width:22px; text-align:center; padding:1px 6px; border-radius:10px; font-size:10px; font-weight:700; color:#fff; background:#e53935;">' + o.n_reclamos + '</span>'
          : '<span style="color:#ccc;">0</span>';
        return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="editarObraData(\'' + _esc(o.id_proyecto) + '\')">' +
          '<td style="padding:4px 6px; font-weight:500;">' + _esc(o.nombre_proyecto) +
            (o.codigo ? ' <span style="font-family:ui-monospace,Consolas,monospace; font-size:10px; color:#546e7a; background:#eceff1; border-radius:3px; padding:0 5px;" title="Job en aSa">' + _esc(o.codigo) + '</span>' : '') +
            '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + (_CLASIF_LABELS[clasif] || clasif) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + empresa + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(o.calculista_nombre || '-') + '</td>' +
          '<td style="padding:4px 6px; text-align:right;">' + (o.total_barras || 0) + '</td>' +
          '<td style="padding:4px 6px; text-align:right; font-size:11px;">' + _kg(o.total_kilos) + '</td>' +
          '<td style="padding:4px 6px; text-align:right;">' + recBadge + '</td>' +
          '<td style="padding:4px 4px; text-align:right;"><button class="secondary" style="font-size:10px; padding:1px 8px; color:#00897b;" onclick="event.stopPropagation(); editarObraData(\'' + _esc(o.id_proyecto) + '\')">✏️ Editar</button></td>' +
          '</tr>';
      }).join('') +
      '</table>' +
      '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' de ' + _obrasData.length + ' obra(s)</div>';
  }

  function limpiarFiltrosObras() {
    var b = document.getElementById('cliFiltroBusqueda'); if (b) b.value = '';
    ['cliFiltroClasif', 'cliFiltroEmpresa'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    var chk = document.getElementById('cliFiltroSinEmpresa'); if (chk) chk.checked = false;
    renderObrasLista();
  }

  function editarObraData(idProyecto) {
    var o = _obrasData.filter(function(x) { return x.id_proyecto === idProyecto; })[0];
    if (!o) return;
    document.getElementById('obraId').value = o.id_proyecto;
    document.getElementById('obraModalNombre').value = o.nombre_proyecto || '';
    var lblId = document.getElementById('obraModalId');
    if (lblId) lblId.textContent = 'ID: ' + o.id_proyecto + ' (no se puede cambiar)';
    document.getElementById('obraClasificacion').value = o.clasificacion || 'obra';
    // Selector de empresa (entidades)
    var empSel = document.getElementById('obraEmpresa');
    if (empSel) {
      empSel.innerHTML = '<option value="">— Sin empresa —</option>' +
        _empresasData.map(function(e) {
          return '<option value="' + e.id + '"' + (e.id === o.constructora_id ? ' selected' : '') + '>' + _esc(e.nombre) + ' (' + (_TIPO_EMP_LABELS[e.tipo] || e.tipo) + ')</option>';
        }).join('');
      if (o.constructora_id) empSel.value = o.constructora_id;
    }
    // Selector de calculista
    var calcSel = document.getElementById('obraCalculista');
    if (calcSel) {
      calcSel.innerHTML = '<option value="">— Sin calculista —</option>' +
        _calculistasCache.map(function(c) {
          return '<option value="' + c.id + '"' + (c.id === o.calculista_id ? ' selected' : '') + '>' + _esc(c.nombre) + '</option>';
        }).join('');
      if (o.calculista_id) calcSel.value = o.calculista_id;
    }
    document.getElementById('obraFechaInicio').value = (typeof formatDateInput === 'function' ? formatDateInput(o.fecha_inicio) : (o.fecha_inicio || '')) || '';
    document.getElementById('obraDescripcion').value = o.descripcion || '';
    var stats = document.getElementById('obraStats');
    if (stats) stats.textContent = (o.total_items != null ? (o.total_items + ' items · ') : '') + (o.total_barras || 0) + ' barras · ' + _kg(o.total_kilos) +
      ' · ' + (o.n_reclamos || 0) + ' reclamo(s)' + (o.diam_prom ? (' · Ø prom ' + o.diam_prom + ' mm') : '');
    document.getElementById('obraModalMsg').textContent = '';
    document.getElementById('obraModal').style.display = 'block';
  }

  function cerrarModalObra() { document.getElementById('obraModal').style.display = 'none'; }

  async function guardarObraData() {
    var msg = document.getElementById('obraModalMsg');
    var id = document.getElementById('obraId').value;
    if (!id) return;
    // El nombre viaja solo si quedo NO VACIO: borrar el campo no borra el nombre
    // (el PATCH del backend solo toca lo enviado — regla de la casa).
    var nombreNuevo = document.getElementById('obraModalNombre').value.trim();
    var body = {
      clasificacion: document.getElementById('obraClasificacion').value || 'obra',
      constructora_id: parseInt(document.getElementById('obraEmpresa').value) || 0,
      calculista_id: parseInt(document.getElementById('obraCalculista').value) || 0,
      descripcion: document.getElementById('obraDescripcion').value.trim(),
      fecha_inicio: document.getElementById('obraFechaInicio').value || ''
    };
    if (nombreNuevo) body.nombre_proyecto = nombreNuevo;
    msg.textContent = 'Guardando...'; msg.style.color = '#666';
    var res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(id)), {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      // Optimistic update (SPECS §2.4): actualizar en memoria, no recargar /proyectos.
      var o = _obrasData.filter(function(x) { return x.id_proyecto === id; })[0];
      if (o) {
        if (body.nombre_proyecto) o.nombre_proyecto = body.nombre_proyecto;
        o.clasificacion = body.clasificacion;
        o.constructora_id = body.constructora_id || null;
        o.constructora_nombre = body.constructora_id ? _empNombre(body.constructora_id) : null;
        o.calculista_id = body.calculista_id || null;
        var calc = _calculistasCache.filter(function(c) { return c.id === body.calculista_id; })[0];
        o.calculista_nombre = calc ? calc.nombre : null;
        o.descripcion = body.descripcion || null;
        o.fecha_inicio = body.fecha_inicio || null;
      }
      cerrarModalObra();
      if (typeof showToast === 'function') showToast('Obra actualizada', 'success');
      renderObrasLista();
    } else {
      msg.textContent = 'Error: ' + _errDetail(data); msg.style.color = '#b42318';
    }
  }

  // ----- Crear nueva obra (POST /proyectos) -----
  // «CREAR OBRA» SE FUE (13-oct): las obras se traen desde aSa en Cubicaciones. Las tres
  // funciones quedan sólo para que un botón viejo diga por qué ya no hace nada.
  function abrirModalNuevaObra() {
    if (typeof showToast === 'function') showToast('Las obras ya no se crean a mano: se traen desde aSa en Cubicaciones («Traer obra de aSa»).', 'error');
  }
  function cerrarModalNuevaObra() {}

  async function guardarNuevaObra() { abrirModalNuevaObra(); }


  // ======================= SUB-TAB EMPRESAS =======================
  // ══════ LOS CLIENTES, COMO LOS VE aSa ══════
  // Una fila por cliente de aSa: sus obras, kilos del año, última actividad, y al lado lo
  // que ArmaHub le agregó (si algo). Lo activo primero. Clic en la fila: sus obras.
  function renderEmpresasLista() {
    var cont = document.getElementById('empresasLista');
    if (!cont) return;
    var busq = ((document.getElementById('empFiltroBusqueda') || {}).value || '').trim().toLowerCase();
    var rows = _clientesAsa.filter(function(c) {
      if (!busq) return true;
      var a = c.armahub || {};
      var blob = (c.cliente_asa + ' ' + (a.nombre || '') + ' ' + (a.rut || '') + ' ' + (a.contacto || '') + ' ' +
                  c.obras.map(function(o) { return o.nombre + ' ' + o.asa_job_id; }).join(' ')).toLowerCase();
      return blob.indexOf(busq) !== -1;
    });
    var res = document.getElementById('cliAsaResumen');
    if (res) res.textContent = _clientesAsa.length + ' cliente(s) en aSa · ' +
      _clientesAsa.filter(function(c) { return c.armahub; }).length + ' con datos de ArmaHub';
    if (!rows.length) {
      cont.innerHTML = '<div class="muted">Ningún cliente de aSa coincide.</div>';
      return;
    }
    var puede = _puedeGestionarCalc();
    var otrasOpc = _empresasData.map(function(e) {
      return '<option value="' + e.id + '">' + _esc(e.nombre) + '</option>'; }).join('');
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:5px 6px;">Cliente (aSa)</th>' +
        '<th style="padding:5px 6px; text-align:right;" title="Abiertas / total">Obras</th>' +
        '<th style="padding:5px 6px; text-align:right;">Kilos 12 m</th>' +
        '<th style="padding:5px 6px;">Último pedido</th>' +
        '<th style="padding:5px 6px;">Datos en ArmaHub</th>' +
        '<th style="padding:5px 4px;"></th>' +
      '</tr>' +
      rows.map(function(c) {
        var a = c.armahub;
        var key = c.cliente_asa.replace(/'/g, "\\'");
        var datos = a
          ? '<b>' + _esc(a.nombre) + '</b>' + (a.rut ? ' · ' + _esc(a.rut) : '') + (a.contacto ? ' · ' + _esc(a.contacto) : '')
          : '<span class="muted">—</span>';
        var acciones = '';
        if (puede) {
          acciones = a
            ? '<button class="secondary" style="font-size:10px; padding:1px 8px; color:#00695c;" onclick="event.stopPropagation(); editarDatosCliente(' + a.id + ', \'' + key + '\')">✏️ Datos</button>'
            : '<button class="secondary" style="font-size:10px; padding:1px 8px; color:#00695c;" onclick="event.stopPropagation(); complementarCliente(\'' + key + '\', null)">＋ Agregar datos</button>' +
              (otrasOpc ? ' <select style="font-size:10px; max-width:150px;" onclick="event.stopPropagation()" onchange="event.stopPropagation(); if (this.value) complementarCliente(\'' + key + '\', parseInt(this.value))" title="Si este nombre es otra grafía de un cliente que ya tiene datos, júntalos.">' +
                '<option value="">Es el mismo que…</option>' + otrasOpc + '</select>' : '');
        }
        var abierto = _cliAbierto === c.cliente_asa;
        var fila = '<tr style="border-bottom:1px solid #eee; cursor:pointer;' + (abierto ? ' background:#f1f8e9;' : '') + '" onclick="toggleObrasCliente(\'' + key + '\')">' +
          '<td style="padding:4px 6px; font-weight:500;">' + _esc(c.cliente_asa) + '</td>' +
          '<td style="padding:4px 6px; text-align:right;">' + c.n_abiertas + ' / ' + c.n_obras + '</td>' +
          '<td style="padding:4px 6px; text-align:right; font-size:11px;">' + _kg(Math.round(c.kg_12m)) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + (c.ultimo_pedido ? c.ultimo_pedido.slice(0, 10) : '—') + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + datos + '</td>' +
          '<td style="padding:4px 4px; white-space:nowrap; text-align:right;">' + acciones + '</td>' +
          '</tr>';
        if (abierto) {
          fila += '<tr><td colspan="6" style="padding:4px 6px 10px 22px; background:#fafafa;">' +
            '<table style="width:100%; font-size:11px; border-collapse:collapse;">' +
            c.obras.map(function(o) {
              return '<tr>' +
                '<td style="padding:2px 6px; font-family:ui-monospace,Consolas,monospace; color:#546e7a;">' + _esc(o.asa_job_id) + '</td>' +
                '<td style="padding:2px 6px;">' + _esc(o.nombre || '') + '</td>' +
                '<td style="padding:2px 6px; color:' + (o.estado === 'Open' ? '#2e7d32' : '#90a4ae') + ';">' + _esc(o.estado || '') + '</td>' +
                '<td style="padding:2px 6px; color:#90a4ae;">' + (o.id_proyecto ? (o.en_cubicacion ? 'en Cubicaciones' : 'en ArmaHub') : '') + '</td>' +
                '</tr>';
            }).join('') + '</table></td></tr>';
        }
        return fila;
      }).join('') +
      '</table>' +
      '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' cliente(s)</div>' +
      (_clientesSueltas.length
        ? '<div style="margin-top:12px; padding:8px 10px; background:#fff8e1; border:1px solid #ffe082; border-radius:6px; font-size:11px;">' +
          '<b>Constructoras sin cliente de aSa (' + _clientesSueltas.length + '):</b> ' +
          _clientesSueltas.map(function(s) { return _esc(s.nombre); }).join(' · ') +
          '<div class="muted" style="margin-top:3px;">Son datos de ArmaHub que todavía no están enlazados a ningún nombre de aSa. Búscalas arriba y usa «Es el mismo que…».</div></div>'
        : '');
  }

  function toggleObrasCliente(nombreAsa) {
    _cliAbierto = (_cliAbierto === nombreAsa) ? null : nombreAsa;
    renderEmpresasLista();
  }

  // LA ÚNICA FORMA DE QUE NAZCA UNA CONSTRUCTORA: desde un cliente de aSa. Con
  // `constructoraId` junta esta grafía a una que ya existe («es el mismo que…»).
  async function complementarCliente(nombreAsa, constructoraId) {
    var res = await fetch(apiUrl('/clientes/asa/complementar'), {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre_asa: nombreAsa, constructora_id: constructoraId || null })
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (!res.ok || !data.ok) {
      if (typeof showToast === 'function') showToast('Error: ' + _errDetail(data), 'error');
      return;
    }
    await _cargarEmpresas();
    renderEmpresasLista();
    if (typeof showToast === 'function') {
      showToast(constructoraId ? 'Grafía junta al cliente' : (data.creada ? 'Cliente creado en ArmaHub: completa sus datos' : 'Cliente enlazado'), 'success');
    }
    if (!constructoraId) editarDatosCliente(data.constructora_id, nombreAsa);
  }

  function editarDatosCliente(id, nombreAsa) {
    editarEmpresa(id);
    var t = document.getElementById('empresaModalTitulo');
    if (t) t.textContent = 'Datos del cliente en ArmaHub';
    var al = document.getElementById('empAliasAsa');
    if (al) {
      var nombres = _clientesAsa.filter(function(c) { return c.armahub && c.armahub.id === id; })
                                .map(function(c) { return c.cliente_asa; });
      al.textContent = nombres.length ? 'En aSa aparece como: ' + nombres.join(' · ') : '';
    }
  }

  function abrirModalEmpresa() {
    // Retirado (13-oct): el cliente viene de aSa y sus datos de ArmaHub se agregan desde
    // su fila. Queda para que cualquier botón viejo lo diga en vez de abrir un formulario
    // que crearía un cliente suelto.
    if (typeof showToast === 'function') showToast('Los clientes vienen de aSa: usa «Agregar datos» en su fila.', 'error');
    return;
    _setEmpForm({});
    document.getElementById('empId').value = '';
    document.getElementById('empresaModalTitulo').textContent = 'Nueva empresa';
    document.getElementById('empModalMsg').textContent = '';
    document.getElementById('empresaModal').style.display = 'block';
    document.getElementById('empNombre').focus();
  }
  function editarEmpresa(id) {
    var e = _empresasData.filter(function(x) { return x.id === id; })[0];
    if (!e) return;
    _setEmpForm(e);
    document.getElementById('empId').value = e.id;
    document.getElementById('empresaModalTitulo').textContent = 'Editar empresa';
    document.getElementById('empModalMsg').textContent = '';
    document.getElementById('empresaModal').style.display = 'block';
  }
  function _setEmpForm(e) {
    document.getElementById('empNombre').value = e.nombre || '';
    document.getElementById('empTipo').value = e.tipo || 'constructora';
    document.getElementById('empRut').value = e.rut || '';
    document.getElementById('empContacto').value = e.contacto || '';
    document.getElementById('empEmail').value = e.email || '';
    document.getElementById('empTelefono').value = e.telefono || '';
    document.getElementById('empNotas').value = e.notas || '';
  }
  function cerrarModalEmpresa() { document.getElementById('empresaModal').style.display = 'none'; }

  async function guardarEmpresa() {
    var msg = document.getElementById('empModalMsg');
    var id = document.getElementById('empId').value;
    var nombre = document.getElementById('empNombre').value.trim();
    if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
    var body = {
      nombre: nombre,
      tipo: document.getElementById('empTipo').value || 'constructora',
      rut: document.getElementById('empRut').value.trim() || null,
      contacto: document.getElementById('empContacto').value.trim() || null,
      email: document.getElementById('empEmail').value.trim() || null,
      telefono: document.getElementById('empTelefono').value.trim() || null,
      notas: document.getElementById('empNotas').value.trim() || null
    };
    if (!id) { msg.textContent = 'Los clientes vienen de aSa: usa «Agregar datos» en la lista.'; msg.style.color = '#b42318'; return; }
    msg.textContent = 'Guardando...'; msg.style.color = '#666';
    var url = '/constructoras/' + id;
    var res = await fetch(apiUrl(url), {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      cerrarModalEmpresa();
      if (typeof showToast === 'function') showToast('Datos del cliente actualizados', 'success');
      await _cargarEmpresas();   // recarga solo empresas (lista chica, no pesa)
      // Al editar una empresa, el nombre embebido en las obras (constructora_nombre)
      // queda desactualizado en _obrasData. Refrescarlo en memoria para que el
      // sub-tab Obras muestre el cambio sin F5.
      if (id) {
        var idNum = parseInt(id);
        _obrasData.forEach(function(o) {
          if (o.constructora_id === idNum) o.constructora_nombre = body.nombre;
        });
      }
      renderEmpresasLista();
    } else {
      msg.textContent = 'Error: ' + _errDetail(data); msg.style.color = '#b42318';
    }
  }

  async function eliminarEmpresa(id) {
    var e = _empresasData.filter(function(x) { return x.id === id; })[0];
    var nombre = e ? e.nombre : ('#' + id);
    var chk = await apiGet('/constructoras/' + id + '/puede-eliminar');
    if (!chk) return;
    if (!chk.puede) {
      if (chk.motivo === 'tiene_obras') {
        var lista = (chk.obras || []).map(function(o) { return '• ' + o.nombre_proyecto; }).join('\n');
        alert('No se puede eliminar "' + nombre + '":\n\n' + chk.mensaje +
              (lista ? '\n\nObras asignadas:\n' + lista : '') +
              '\n\nDesde el sub-tab Obras, cambia la empresa de esas obras (o déjalas sin empresa) y vuelve a intentar.');
      } else {
        alert(chk.mensaje || 'No se puede eliminar esta empresa.');
      }
      return;
    }
    if (!confirm('¿Eliminar la empresa "' + nombre + '"? Esta acción no se puede deshacer.')) return;
    var res = await fetch(apiUrl('/constructoras/' + id), { method: 'DELETE', headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      if (typeof showToast === 'function') showToast('Empresa eliminada', 'success');
      await _cargarEmpresas();
      renderEmpresasLista();
    } else {
      alert('Error: ' + _errDetail(data));
    }
  }

  // ======================= SUB-TAB CALCULISTAS =======================
  // El CRUD de calculistas (POST/PATCH/DELETE) es admin/admin_calidad only.
  function _puedeGestionarCalc() {
    return (typeof currentRole !== 'undefined') && (currentRole === 'admin' || currentRole === 'admin_calidad');
  }

  function renderCalculistasLista() {
    var cont = document.getElementById('calculistasLista');
    if (!cont) return;
    var btn = document.getElementById('btnNuevoCalc');
    if (btn) btn.style.display = _puedeGestionarCalc() ? '' : 'none';
    var busq = ((document.getElementById('calcFiltroBusqueda') || {}).value || '').trim().toLowerCase();
    var rows = _calculistasCache.filter(function(c) {
      if (!busq) return true;
      return ((c.nombre || '') + ' ' + (c.email || '')).toLowerCase().indexOf(busq) !== -1;
    });
    if (rows.length === 0) {
      cont.innerHTML = '<div class="muted">No hay calculistas registrados.' +
        (_puedeGestionarCalc() ? ' Crea el primero con "+ Nuevo calculista".' : '') + '</div>';
      return;
    }
    var puede = _puedeGestionarCalc();
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:5px 6px;">Nombre</th>' +
        '<th style="padding:5px 6px;">Email</th>' +
        '<th style="padding:5px 6px; text-align:right;">Obras</th>' +
        '<th style="padding:5px 6px; text-align:right;">Kilos</th>' +
        '<th style="padding:5px 4px;"></th>' +
      '</tr>' +
      rows.map(function(c) {
        var acciones = puede
          ? '<button class="secondary" title="Editar" style="font-size:10px; padding:1px 6px; color:#5e35b1; margin-right:3px;" onclick="editarCalc(' + c.id + ')">✏️</button>' +
            '<button class="secondary" title="Eliminar" style="font-size:10px; padding:1px 6px; color:#b42318;" onclick="eliminarCalc(' + c.id + ')">✕</button>'
          : '';
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:4px 6px; font-weight:500;">' + _esc(c.nombre) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(c.email || '-') + '</td>' +
          '<td style="padding:4px 6px; text-align:right;">' + (c.proyectos_count || 0) + '</td>' +
          '<td style="padding:4px 6px; text-align:right; font-size:11px;">' + _kg(c.total_kilos) + '</td>' +
          '<td style="padding:4px 4px; white-space:nowrap; text-align:right;">' + acciones + '</td>' +
          '</tr>';
      }).join('') +
      '</table>' +
      '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' calculista(s)</div>';
  }

  function abrirModalCalc() {
    document.getElementById('calcId').value = '';
    document.getElementById('calcNombre').value = '';
    document.getElementById('calcEmail').value = '';
    document.getElementById('calcModalTitulo').textContent = 'Nuevo calculista';
    document.getElementById('calcModalMsg').textContent = '';
    document.getElementById('calcModal').style.display = 'block';
    document.getElementById('calcNombre').focus();
  }
  function editarCalc(id) {
    var c = _calculistasCache.filter(function(x) { return x.id === id; })[0];
    if (!c) return;
    document.getElementById('calcId').value = c.id;
    document.getElementById('calcNombre').value = c.nombre || '';
    document.getElementById('calcEmail').value = c.email || '';
    document.getElementById('calcModalTitulo').textContent = 'Editar calculista';
    document.getElementById('calcModalMsg').textContent = '';
    document.getElementById('calcModal').style.display = 'block';
  }
  function cerrarModalCalc() { document.getElementById('calcModal').style.display = 'none'; }

  async function guardarCalc() {
    var msg = document.getElementById('calcModalMsg');
    var id = document.getElementById('calcId').value;
    var nombre = document.getElementById('calcNombre').value.trim();
    if (!nombre) { msg.textContent = 'El nombre es requerido'; msg.style.color = '#b42318'; return; }
    var body = { nombre: nombre, email: document.getElementById('calcEmail').value.trim() || null };
    msg.textContent = 'Guardando...'; msg.style.color = '#666';
    var url = id ? ('/calculistas/' + id) : '/calculistas';
    var res = await fetch(apiUrl(url), {
      method: id ? 'PATCH' : 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      cerrarModalCalc();
      if (typeof showToast === 'function') showToast(id ? 'Calculista actualizado' : 'Calculista creado', 'success');
      await _cargarCalculistas();   // lista chica, no pesa
      // Refrescar el nombre del calculista embebido en las obras (sin F5).
      if (id) {
        var idNum = parseInt(id);
        _obrasData.forEach(function(o) {
          if (o.calculista_id === idNum) o.calculista_nombre = body.nombre;
        });
      }
      renderCalculistasLista();
    } else {
      msg.textContent = 'Error: ' + _errDetail(data); msg.style.color = '#b42318';
    }
  }

  async function eliminarCalc(id) {
    var c = _calculistasCache.filter(function(x) { return x.id === id; })[0];
    var nombre = c ? c.nombre : ('#' + id);
    if (c && c.proyectos_count > 0) {
      alert('No se puede eliminar "' + nombre + '": tiene ' + c.proyectos_count + ' obra(s) asignada(s). ' +
            'Cambia el calculista de esas obras primero.');
      return;
    }
    if (!confirm('¿Eliminar el calculista "' + nombre + '"?')) return;
    var res = await fetch(apiUrl('/calculistas/' + id), { method: 'DELETE', headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      if (typeof showToast === 'function') showToast('Calculista eliminado', 'success');
      await _cargarCalculistas();
      renderCalculistasLista();
    } else {
      alert('Error: ' + _errDetail(data));
    }
  }

  // Exponer como globales (onclick del HTML + loader del shell)
  global.loadClientesModule = loadClientesModule;
  global.toggleObrasCliente = toggleObrasCliente;
  global.complementarCliente = complementarCliente;
  global.editarDatosCliente = editarDatosCliente;
  global.switchCliSubTab = switchCliSubTab;
  global.renderObrasLista = renderObrasLista;
  global.limpiarFiltrosObras = limpiarFiltrosObras;
  global.editarObraData = editarObraData;
  global.cerrarModalObra = cerrarModalObra;
  global.guardarObraData = guardarObraData;
  global.abrirModalNuevaObra = abrirModalNuevaObra;
  global.cerrarModalNuevaObra = cerrarModalNuevaObra;
  global.guardarNuevaObra = guardarNuevaObra;
  global.renderEmpresasLista = renderEmpresasLista;
  global.abrirModalEmpresa = abrirModalEmpresa;
  global.editarEmpresa = editarEmpresa;
  global.cerrarModalEmpresa = cerrarModalEmpresa;
  global.guardarEmpresa = guardarEmpresa;
  global.eliminarEmpresa = eliminarEmpresa;
  global.renderCalculistasLista = renderCalculistasLista;
  global.abrirModalCalc = abrirModalCalc;
  global.editarCalc = editarCalc;
  global.cerrarModalCalc = cerrarModalCalc;
  global.guardarCalc = guardarCalc;
  global.eliminarCalc = eliminarCalc;
})(window);
