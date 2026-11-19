/* armascanner/index.js — la caluga ArmaScanner (19-nov, SPECS §13).
 *
 * [Usuario 19-nov: «Más que pedidos enviados debiera ver sus obras y ojalá una línea por cada
 * carga de elemento constructivo… Con su cantidad de Items, kilos y lo típico que usamos. La
 * licencia capaz la dejamos acá, aquí buscamos un usuario existente y lo agregamos»]
 *
 * Pestañas (templates/tabs/armascanner.html):
 *   Mis obras  GET /armascanner/cargas       una línea por carga (cada plano, un elemento)
 *   Instalar   GET /armascanner/mi-licencia  mi licencia y mis equipos
 *   Licencias  GET /armascanner/licencias    (administración) dar, vencer, quitar, liberar equipos
 *   Uso        GET /armascanner/uso          (administración) KPIs y uso por usuario
 * Los cambios de licencia usan las rutas de siempre: PUT /admin/users/{id}/licencias/armascanner
 * y POST …/liberar.
 */
(function (global) {
  'use strict';

  var est = { cargas: [], elemento: '', buscadorObra: null, usuarios: null, combo: null, usuarioElegido: null,
              licencias: [] };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function entero(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function fecha(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : '';
  }
  function quien(email) { return String(email || '').split('@')[0]; }
  function poner(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }

  // ── Mis obras ──
  function filtradas() {
    var obra = est.buscadorObra ? est.buscadorObra.getId() : '';
    return est.cargas.filter(function (c) {
      return (!obra || c.obra === obra) && (!est.elemento || (c.elemento || '').split(', ').indexOf(est.elemento) !== -1);
    });
  }

  function pintarCargas() {
    var filas = filtradas();
    var items = 0, kg = 0, pend = 0;
    var html = filas.map(function (c) {
      items += c.items; kg += c.kg; pend += c.pendientes;
      var estado = c.pendientes
        ? '<span class="arm-tag arm-tag--warning">' + entero(c.pendientes) + ' sin aprobar</span>'
        : '<span class="arm-tag arm-tag--success">Exportable</span>';
      return '<tr>' +
        '<td>' + esc(c.obra_nombre) + '</td>' +
        '<td class="corto" title="' + esc(c.plano) + '">' + esc(c.plano) + '</td>' +
        '<td>' + esc(c.elemento) + '</td>' +
        '<td>' + esc(c.piso) + '</td>' +
        '<td>' + esc(c.ciclos) + '</td>' +
        '<td class="num">' + entero(c.items) + '</td>' +
        '<td class="num">' + entero(c.kg) + '</td>' +
        '<td class="num">' + (c.items ? (c.kg / c.items).toFixed(1).replace('.', ',') : '—') + '</td>' +
        '<td>' + estado + '</td>' +
        '<td>' + esc(quien(c.usuario)) + '</td>' +
        '<td>' + fecha(c.fecha) + '</td></tr>';
    }).join('');
    document.getElementById('ascCargas').innerHTML = html;
    document.getElementById('ascCargasVacio').style.display = filas.length ? 'none' : '';
    poner('ascKpiPlanos', entero(filas.length));
    poner('ascKpiItems', entero(items));
    poner('ascKpiKg', entero(kg) + ' kg');
    poner('ascKpiPend', entero(pend));
  }

  async function cargarObras() {
    if (!est.buscadorObra && global.BuscadorObra) {
      est.buscadorObra = global.BuscadorObra.crear({
        inputId: 'ascObraInput', datalistId: 'ascObraDatalist', selectId: 'ascObraSelect',
        onElegir: function () { pintarCargas(); }
      });
    }
    var d = await global.apiGet('/armascanner/cargas');
    est.cargas = (d && d.cargas) || [];
    var vistas = {};
    var obras = [];
    est.cargas.forEach(function (c) {
      if (!vistas[c.obra]) { vistas[c.obra] = 1; obras.push({ id: c.obra, nombre: c.obra_nombre }); }
    });
    if (est.buscadorObra) est.buscadorObra.setProyectos(obras);
    // El select oculto guarda el id elegido (BuscadorObra): sin sus opciones no filtra nada.
    document.getElementById('ascObraSelect').innerHTML = '<option value=""></option>' + obras.map(function (o) {
      return '<option value="' + esc(o.id) + '">' + esc(o.nombre) + '</option>';
    }).join('');
    pintarCargas();
    // Si ArmaHub no contestó, se dice: la lista vacía haría creer que no hay nada subido.
    document.getElementById('ascCargasVacio').textContent = d ? 'Sin planos subidos desde ArmaScanner.'
      : 'No se pudo leer lo subido. Recarga la página.';
  }

  // ── Instalar ──
  function mb(bytes) { return bytes ? (bytes / 1e6).toFixed(1).replace('.', ',') + ' MB' : ''; }

  async function descargar() {
    var v = await global.apiGet('/armascanner/descarga');  // el enlace vale unos minutos: se pide al apretar
    if (v && v.url) global.location.href = v.url;
  }

  async function cargarInstalar() {
    var b = document.getElementById('ascDescargar');
    if (!b.dataset.listo) { b.addEventListener('click', descargar); b.dataset.listo = '1'; }
    var v = await global.apiGet('/armascanner/descarga');
    b.disabled = !(v && v.version);
    // Un ZIP: se descomprime y se abre ArmaScanner.exe, que se instala solo (instalacion.py).
    document.getElementById('ascDescargaLinea').textContent = v && v.version
      ? 'Versión ' + v.version + ' · ' + mb(v.tamano) + ' · Descomprime y abre ArmaScanner.exe'
      : 'Sin versión publicada.';
    var d = await global.apiGet('/armascanner/mi-licencia');
    if (!d) return;
    document.getElementById('ascMiEstado').innerHTML = d.activa
      ? '<span class="arm-tag arm-tag--success">Activa' + (d.vence ? ' hasta ' + fecha(d.vence) : '') + '</span>'
      : '<span class="arm-tag arm-tag--danger">Sin licencia</span>';
    var eq = d.equipos || [];
    document.getElementById('ascMisEquipos').innerHTML = eq.length
      ? eq.map(function (e) {
          return '<tr><td>' + esc(e.equipo) + '</td><td>' + fecha(e.ultimo_uso) + '</td><td>' + esc(e.version || '') + '</td></tr>';
        }).join('')
      : '<tr><td colspan="3" class="asc-vacio">Sin equipos. Se registran al abrir ArmaScanner.</td></tr>';
  }

  // ── Licencias (administración) ──
  async function guardarLicencia(userId, activa, vence) {
    var res = await fetch(global.apiUrl('/admin/users/' + userId + '/licencias/armascanner'), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, global.authHeaders()),
      body: JSON.stringify({ activa: activa, vence: activa && vence ? vence : null })
    });
    if (res.status === 401) { global.logout(); return false; }
    var data = await res.json().catch(function () { return {}; });
    if (!data.ok) { global.showToast('No se guardó: ' + (data.detail || 'error'), 'error'); return false; }
    return true;
  }

  function pintarLicencias() {
    var hoy = new Date().toISOString().slice(0, 10);
    var html = est.licencias.map(function (l, i) {
      var vencida = l.activa && l.vence && l.vence < hoy;
      var estado = !l.activa ? '<span class="arm-tag">Retirada</span>'
        : vencida ? '<span class="arm-tag arm-tag--danger">Vencida</span>'
        : '<span class="arm-tag arm-tag--success">Activa</span>';
      var equipos = (l.equipos || []).map(function (e, k) {
        return '<div style="display:flex; align-items:center; gap:6px; margin:2px 0;">' + esc(e.equipo) +
          ' <button class="arm-button" style="min-height:24px; padding:0 8px; font-size:12px;"' +
          ' onclick="ascLiberar(' + i + ',' + k + ')">Liberar</button></div>';
      }).join('') || '<span class="asc-linea">—</span>';
      return '<tr>' +
        '<td><div>' + esc(l.nombre) + '</div><div class="asc-linea">' + esc(l.email) + '</div></td>' +
        '<td>' + estado + '</td>' +
        '<td><input type="date" class="arm-input" value="' + esc(l.vence || '') + '"' + (l.activa ? '' : ' disabled') +
          ' onchange="ascVencimiento(' + i + ', this.value)" style="min-height:30px;"></td>' +
        '<td>' + equipos + '<div class="asc-linea">' + (l.equipos || []).length + ' de ' + (l.max_equipos || 2) + '</div></td>' +
        '<td>' + fecha(l.ultimo_uso) + '</td>' +
        '<td style="text-align:right;">' + (l.activa
          ? '<button class="arm-button arm-button--danger" onclick="ascQuitar(' + i + ')">Quitar</button>'
          : '<button class="arm-button" onclick="ascDarDeNuevo(' + i + ')">Activar</button>') + '</td></tr>';
    }).join('');
    document.getElementById('ascLicencias').innerHTML = html;
    document.getElementById('ascLicenciasVacio').style.display = est.licencias.length ? 'none' : '';
  }

  async function cargarLicencias() {
    if (!est.combo && global.Combobox) {
      est.combo = global.Combobox.crear(document.getElementById('ascUsuarioInput'), {
        items: function () { return est.usuarios || []; },
        getLabel: function (u) { return u.label; },
        getSub: function (u) { return u.sub; },
        onSelect: function (u) { est.usuarioElegido = u; },
        placeholder: 'Buscar usuario'
      });
      document.getElementById('ascAgregar').addEventListener('click', agregar);
    }
    var res = await Promise.all([global.apiGet('/armascanner/licencias'),
                                 est.usuarios ? null : global.apiGet('/admin/users')]);
    est.licencias = (res[0] && res[0].licencias) || [];
    if (res[1] && res[1].users) {
      est.usuarios = res[1].users.filter(function (u) { return u.activo !== false; }).map(function (u) {
        var nombre = ((u.nombre || '') + ' ' + (u.apellido || '')).trim();
        return { id: u.id, label: nombre || u.email, sub: u.email };
      });
    }
    pintarLicencias();
  }

  async function agregar() {
    var u = est.usuarioElegido;
    if (!u) { global.showToast('Elige un usuario de la lista.', 'warning'); return; }
    if (await guardarLicencia(u.id, true, document.getElementById('ascVence').value)) {
      global.showToast('Licencia activa: ' + u.label, 'success');
      est.combo.limpiar();
      est.usuarioElegido = null;
      document.getElementById('ascVence').value = '';
      await cargarLicencias();
    }
  }

  global.ascVencimiento = async function (i, vence) {
    var l = est.licencias[i];
    if (l && await guardarLicencia(l.user_id, true, vence)) await cargarLicencias();
  };
  global.ascQuitar = async function (i) {
    var l = est.licencias[i];
    if (!l || !confirm('¿Quitar la licencia de ' + l.nombre + '? ArmaScanner deja de abrir en sus equipos.')) return;
    if (await guardarLicencia(l.user_id, false, null)) await cargarLicencias();
  };
  global.ascDarDeNuevo = async function (i) {
    var l = est.licencias[i];
    if (l && await guardarLicencia(l.user_id, true, null)) await cargarLicencias();
  };
  global.ascLiberar = async function (i, k) {
    var l = est.licencias[i];
    var e = l && (l.equipos || [])[k];
    if (!e || !confirm('¿Liberar el equipo «' + e.equipo + '»? Su cupo queda libre.')) return;
    var res = await fetch(global.apiUrl('/admin/users/' + l.user_id + '/licencias/armascanner/liberar'), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, global.authHeaders()),
      body: JSON.stringify({ equipo: e.equipo })
    });
    if (res.status === 401) { global.logout(); return; }
    var data = await res.json().catch(function () { return {}; });
    if (!data.ok) { global.showToast('No se liberó: ' + (data.detail || 'error'), 'error'); return; }
    await cargarLicencias();
  };

  // ── Uso (administración) ──
  async function cargarUso() {
    var d = await global.apiGet('/armascanner/uso');
    if (!d) return;
    poner('ascUsoLic', entero(d.licencias_activas));
    poner('ascUsoPlanos', entero(d.planos));
    poner('ascUsoKg', entero(d.kg) + ' kg');
    poner('ascUsoAprob', String(d.aprobadas_pct).replace('.', ',') + ' %');
    var filas = d.por_usuario || [];
    document.getElementById('ascUso').innerHTML = filas.map(function (u) {
      return '<tr><td>' + esc(quien(u.usuario)) + '</td><td class="num">' + entero(u.planos) + '</td>' +
        '<td class="num">' + entero(u.items) + '</td><td class="num">' + entero(u.kg) + '</td>' +
        '<td class="num">' + String(u.aprobadas_pct).replace('.', ',') + ' %</td><td>' + fecha(u.ultima) + '</td></tr>';
    }).join('');
    document.getElementById('ascUsoVacio').style.display = filas.length ? 'none' : '';
  }

  // ── Versiones (administración) ──
  async function cambiarVersion(id, cambio) {
    var res = await fetch(global.apiUrl('/armascanner/versiones/' + id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, global.authHeaders()),
      body: JSON.stringify(cambio)
    });
    if (res.status === 401) { global.logout(); return; }
    var data = await res.json().catch(function () { return {}; });
    if (!data.ok) { global.showToast('No se guardó: ' + (data.detail || 'error'), 'error'); return; }
    await cargarVersiones();
  }
  global.ascVersion = cambiarVersion;

  async function cargarVersiones() {
    var bp = document.getElementById('ascVerPublicar');
    if (!bp.dataset.listo) {
      bp.dataset.listo = '1';
      bp.addEventListener('click', publicar);
      document.getElementById('ascVerArchivo').addEventListener('change', function () {
        var f = this.files[0];
        var m = f && f.name.match(/(\d{4}-\d{2}-\d{2}(?:\.\d+)?)/);  // ArmaScanner-2026-11-19-instalar.exe
        if (m) document.getElementById('ascVerVersion').value = m[1];
      });
    }
    var d = await global.apiGet('/armascanner/versiones');
    var filas = (d && d.versiones) || [];
    document.getElementById('ascVersiones').innerHTML = filas.map(function (v) {
      var estado = !v.activa ? '<span class="arm-tag">Retirada</span>'
        : v.version === d.vigente ? '<span class="arm-tag arm-tag--success">Vigente</span>'
        : '<span class="arm-tag arm-tag--info">Activa</span>';
      if (v.obligatoria) estado += ' <span class="arm-tag arm-tag--warning">Obligatoria</span>';
      return '<tr><td>' + esc(v.version) + '</td>' +
        '<td>' + fecha(v.publicada_el) + '<div class="asc-linea">' + esc(quien(v.publicada_por)) + '</div></td>' +
        '<td class="num">' + mb(v.tamano) + '</td><td>' + esc(v.notas) + '</td><td>' + estado + '</td>' +
        '<td style="text-align:right; white-space:nowrap;">' +
          '<button class="arm-button" onclick="ascVersion(' + v.id + ', {obligatoria: ' + !v.obligatoria + '})">' +
            (v.obligatoria ? 'Opcional' : 'Obligatoria') + '</button> ' +
          (v.activa
            ? '<button class="arm-button arm-button--danger" onclick="ascVersion(' + v.id + ', {activa: false})">Retirar</button>'
            : '<button class="arm-button" onclick="ascVersion(' + v.id + ', {activa: true})">Reponer</button>') +
        '</td></tr>';
    }).join('');
    document.getElementById('ascVersionesVacio').style.display = filas.length ? 'none' : '';
  }

  function publicar() {
    var f = document.getElementById('ascVerArchivo').files[0];
    var version = document.getElementById('ascVerVersion').value.trim();
    var estado = document.getElementById('ascVerEstado');
    if (!f || !version) { global.showToast('Elige el instalador y escribe la versión.', 'warning'); return; }
    var form = new FormData();
    form.append('archivo', f);
    form.append('version', version);
    form.append('notas', document.getElementById('ascVerNotas').value);
    form.append('obligatoria', document.getElementById('ascVerOblig').checked ? 'true' : 'false');
    var xhr = new XMLHttpRequest();  // con XHR para ver el avance de la subida (decenas de MB)
    xhr.open('POST', global.apiUrl('/armascanner/versiones'));
    var cab = global.authHeaders();
    Object.keys(cab).forEach(function (k) { xhr.setRequestHeader(k, cab[k]); });
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) estado.textContent = 'Subiendo ' + Math.round(100 * e.loaded / e.total) + ' %';
    };
    xhr.onload = function () {
      var r = {};
      try { r = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status === 401) { global.logout(); return; }
      if (xhr.status >= 300 || !r.ok) { estado.textContent = ''; global.showToast('No se publicó: ' + (r.detail || xhr.status), 'error'); return; }
      estado.textContent = 'Publicada ' + r.version;
      ['ascVerArchivo', 'ascVerVersion', 'ascVerNotas'].forEach(function (id) { document.getElementById(id).value = ''; });
      document.getElementById('ascVerOblig').checked = false;
      cargarVersiones();
    };
    xhr.onerror = function () { estado.textContent = ''; global.showToast('Se cortó la subida. Vuelve a intentar.', 'error'); };
    estado.textContent = 'Subiendo 0 %';
    xhr.send(form);
  }

  // El filtro de elemento: botones (pocas opciones, skill armacero-ui), uno encendido.
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#ascElemento .arm-button');
    if (!b) return;
    est.elemento = b.getAttribute('data-el') || '';
    document.querySelectorAll('#ascElemento .arm-button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    pintarCargas();
  });

  global.loadArmaScannerModule = function () {};  // cada pestaña carga lo suyo (shell.js, tabLoaders)
  global.ascCargarObras = cargarObras;
  global.ascCargarInstalar = cargarInstalar;
  global.ascCargarLicencias = cargarLicencias;
  global.ascCargarUso = cargarUso;
  global.ascCargarVersiones = cargarVersiones;
})(window);
