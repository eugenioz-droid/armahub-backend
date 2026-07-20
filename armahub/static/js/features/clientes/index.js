// ArmaHub — Caluga Constructoras / Clientes (5L.11, rework)
// La OBRA (proyectos) es el registro principal. La caluga lista las obras que ya
// existen y permite completar/editar su data: clasificación (obra/tienda/otro),
// empresa (constructora/retail, texto libre con autocompletado), calculista,
// descripción y fecha de inicio. La empresa es un ATRIBUTO de la obra para agrupar
// y filtrar — NO hay una tabla de constructoras que mande.

(function(global) {
  var _obrasData = [];
  var _empresasKnown = [];   // nombres de empresa ya usados (autocompletado + filtro)
  var _calculistasCache = [];

  var _CLASIF_LABELS = { obra: 'Obra', tienda: 'Tienda', otro: 'Otro' };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _kg(v) { return (typeof formatKilos === 'function') ? formatKilos(v) : ((v || 0) + ' kg'); }

  async function loadClientesModule() {
    var cont = document.getElementById('clientesLista');
    if (!cont) return;
    cont.innerHTML = '<div class="muted">Cargando obras...</div>';
    var data = await apiGet('/proyectos');
    if (!data) { cont.innerHTML = '<div class="muted">No fue posible cargar las obras.</div>'; return; }
    _obrasData = data.proyectos || [];
    // Empresas conocidas (para filtro y autocompletado)
    var emp = await apiGet('/proyectos/empresas');
    _empresasKnown = (emp && emp.empresas) || [];
    _poblarFiltroEmpresa();
    _poblarDatalistEmpresa();
    // Calculistas (para el selector del modal)
    if (typeof _calculistasCache !== 'undefined') {
      var calc = await apiGet('/calculistas?activo=true');
      _calculistasCache = (calc && calc.calculistas) || [];
    }
    renderClientesLista();
  }

  function _poblarFiltroEmpresa() {
    var sel = document.getElementById('cliFiltroEmpresa');
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">Empresa: Todas</option>' +
      _empresasKnown.map(function(e) { return '<option value="' + _esc(e) + '">' + _esc(e) + '</option>'; }).join('');
    sel.value = prev;
  }

  function _poblarDatalistEmpresa() {
    var dl = document.getElementById('cliEmpresaList');
    if (!dl) return;
    dl.innerHTML = _empresasKnown.map(function(e) { return '<option value="' + _esc(e) + '"></option>'; }).join('');
  }

  function renderClientesLista() {
    var cont = document.getElementById('clientesLista');
    if (!cont) return;
    var busq = ((document.getElementById('cliFiltroBusqueda') || {}).value || '').trim().toLowerCase();
    var fClasif = (document.getElementById('cliFiltroClasif') || {}).value || '';
    var fEmpresa = (document.getElementById('cliFiltroEmpresa') || {}).value || '';
    var fSinEmpresa = (document.getElementById('cliFiltroSinEmpresa') || {}).checked;

    var rows = _obrasData.filter(function(o) {
      var clasif = o.clasificacion || 'obra';
      var empresa = o.empresa || '';
      if (fClasif && clasif !== fClasif) return false;
      if (fEmpresa && empresa !== fEmpresa) return false;
      if (fSinEmpresa && empresa) return false;
      if (busq) {
        var blob = ((o.nombre_proyecto || '') + ' ' + empresa).toLowerCase();
        if (blob.indexOf(busq) === -1) return false;
      }
      return true;
    });

    // Resumen: cuántas obras sin empresa (lo que falta ordenar)
    var sinEmpresa = _obrasData.filter(function(o) { return !o.empresa; }).length;
    var resumenEl = document.getElementById('cliResumen');
    if (resumenEl) resumenEl.textContent = _obrasData.length + ' obras · ' + sinEmpresa + ' sin empresa';

    if (rows.length === 0) {
      cont.innerHTML = '<div class="muted">No hay obras con ese filtro.</div>';
      return;
    }
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:5px 6px;">Obra</th>' +
        '<th style="padding:5px 6px;">Clasificación</th>' +
        '<th style="padding:5px 6px;">Empresa</th>' +
        '<th style="padding:5px 6px;">Calculista</th>' +
        '<th style="padding:5px 6px; text-align:right;">Barras</th>' +
        '<th style="padding:5px 6px; text-align:right;">Kilos</th>' +
        '<th style="padding:5px 4px;"></th>' +
      '</tr>' +
      rows.map(function(o) {
        var clasif = o.clasificacion || 'obra';
        var empresa = o.empresa
          ? _esc(o.empresa)
          : '<span style="color:#e65100; font-style:italic;">— sin empresa —</span>';
        return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="editarObraData(\'' + _esc(o.id_proyecto) + '\')">' +
          '<td style="padding:4px 6px; font-weight:500;">' + _esc(o.nombre_proyecto) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + (_CLASIF_LABELS[clasif] || clasif) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + empresa + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(o.calculista_nombre || '-') + '</td>' +
          '<td style="padding:4px 6px; text-align:right;">' + (o.total_barras || 0) + '</td>' +
          '<td style="padding:4px 6px; text-align:right; font-size:11px;">' + _kg(o.total_kilos) + '</td>' +
          '<td style="padding:4px 4px; text-align:right;"><button class="secondary" style="font-size:10px; padding:1px 8px; color:#00897b;" onclick="event.stopPropagation(); editarObraData(\'' + _esc(o.id_proyecto) + '\')">✏️ Editar</button></td>' +
          '</tr>';
      }).join('') +
      '</table>' +
      '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' de ' + _obrasData.length + ' obra(s)</div>';
  }

  function limpiarFiltrosClientes() {
    ['cliFiltroBusqueda'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    ['cliFiltroClasif', 'cliFiltroEmpresa'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    var chk = document.getElementById('cliFiltroSinEmpresa'); if (chk) chk.checked = false;
    renderClientesLista();
  }

  // ---- Modal editar data de la obra ----
  function editarObraData(idProyecto) {
    var o = _obrasData.filter(function(x) { return x.id_proyecto === idProyecto; })[0];
    if (!o) return;
    document.getElementById('cliObraId').value = o.id_proyecto;
    document.getElementById('cliModalObraNombre').textContent = o.nombre_proyecto || '';
    document.getElementById('cliClasificacion').value = o.clasificacion || 'obra';
    document.getElementById('cliEmpresa').value = o.empresa || '';
    document.getElementById('cliFechaInicio').value = (typeof formatDateInput === 'function' ? formatDateInput(o.fecha_inicio) : (o.fecha_inicio || '')) || '';
    document.getElementById('cliDescripcion').value = o.descripcion || '';
    // Selector de calculista
    var calcSel = document.getElementById('cliCalculista');
    if (calcSel) {
      calcSel.innerHTML = '<option value="">— Sin calculista —</option>' +
        _calculistasCache.map(function(c) {
          return '<option value="' + c.id + '"' + (c.id === o.calculista_id ? ' selected' : '') + '>' + _esc(c.nombre) + '</option>';
        }).join('');
      if (o.calculista_id) calcSel.value = o.calculista_id;
    }
    // Stats read-only
    var stats = document.getElementById('cliObraStats');
    if (stats) stats.textContent = (o.total_barras || 0) + ' barras · ' + _kg(o.total_kilos) +
      (o.diam_prom ? (' · Ø prom ' + o.diam_prom + ' mm') : '');
    document.getElementById('cliModalMsg').textContent = '';
    document.getElementById('clienteModal').style.display = 'block';
  }

  function cerrarModalCliente() {
    document.getElementById('clienteModal').style.display = 'none';
  }

  async function guardarObraData() {
    var msg = document.getElementById('cliModalMsg');
    var id = document.getElementById('cliObraId').value;
    if (!id) return;
    var body = {
      clasificacion: document.getElementById('cliClasificacion').value || 'obra',
      empresa: document.getElementById('cliEmpresa').value.trim(),
      calculista_id: parseInt(document.getElementById('cliCalculista').value) || 0,
      descripcion: document.getElementById('cliDescripcion').value.trim(),
      fecha_inicio: document.getElementById('cliFechaInicio').value || ''
    };
    msg.textContent = 'Guardando...'; msg.style.color = '#666';
    var res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(id)), {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) {
      // Optimistic update: el servidor confirmó, así que actualizo el dato en memoria
      // y re-renderizo solo la tabla — sin recargar TODO del servidor (evita el lag).
      var o = _obrasData.filter(function(x) { return x.id_proyecto === id; })[0];
      if (o) {
        o.clasificacion = body.clasificacion;
        o.empresa = body.empresa || null;
        o.calculista_id = body.calculista_id || null;
        var calc = _calculistasCache.filter(function(c) { return c.id === body.calculista_id; })[0];
        o.calculista_nombre = calc ? calc.nombre : null;
        o.descripcion = body.descripcion || null;
        o.fecha_inicio = body.fecha_inicio || null;
      }
      // Si la empresa es nueva, incorporarla al autocompletado sin ir al servidor.
      if (body.empresa && _empresasKnown.indexOf(body.empresa) === -1) {
        _empresasKnown.push(body.empresa);
        _empresasKnown.sort();
        _poblarFiltroEmpresa();
        _poblarDatalistEmpresa();
      }
      cerrarModalCliente();
      if (typeof showToast === 'function') showToast('Obra actualizada', 'success');
      renderClientesLista();  // instantáneo, sin red
    } else {
      msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
    }
  }

  // Exponer como globales (onclick del HTML + loader del shell)
  global.loadClientesModule = loadClientesModule;
  global.renderClientesLista = renderClientesLista;
  global.limpiarFiltrosClientes = limpiarFiltrosClientes;
  global.editarObraData = editarObraData;
  global.cerrarModalCliente = cerrarModalCliente;
  global.guardarObraData = guardarObraData;
})(window);
