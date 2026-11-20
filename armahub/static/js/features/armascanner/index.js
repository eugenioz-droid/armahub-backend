/* armascanner/index.js — la caluga ArmaScanner (19-nov, SPECS §13).
 *
 * [Usuario 19-nov: «Más que pedidos enviados debiera ver sus obras y ojalá una línea por cada
 * carga de elemento constructivo… Con su cantidad de Items, kilos y lo típico que usamos. La
 * licencia capaz la dejamos acá, aquí buscamos un usuario existente y lo agregamos»]
 *
 * Pestañas (templates/tabs/armascanner.html):
 *   Mis obras  GET /armascanner/cargas       una línea por carga (cada plano, un elemento)
 *   Planos     GET /armascanner/planos-linea  avance de cada plano guardado; ver barras, enviar
 *              pedido y liberar (…/barras, POST …/pedido, POST …/liberar)
 *   Instalar   GET /armascanner/mi-licencia  mi licencia y mis equipos
 *   Licencias  GET /armascanner/licencias    (administración) dar, vencer, quitar, liberar equipos
 *   Uso        GET /armascanner/uso          (administración) KPIs y uso por usuario
 * Los cambios de licencia usan las rutas de siempre: PUT /admin/users/{id}/licencias/armascanner
 * y POST …/liberar.
 */
(function (global) {
  'use strict';

  var est = { cargas: [], elemento: '', buscadorObra: null, usuarios: null, combo: null, usuarioElegido: null,
              licencias: [], planos: [], plElemento: '', buscadorPlanos: null, verBarras: null };

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
    var vacio = document.getElementById('ascCargasVacio');
    vacio.style.display = filas.length ? 'none' : '';
    // Si ArmaHub no contestó, se dice: la lista vacía haría creer que no hay nada subido.
    vacio.textContent = est.sinRespuesta ? 'No se pudo leer lo subido. Recarga la página.'
      : est.cargas.length ? 'Sin cargas con este filtro.' : 'Sin planos subidos desde ArmaScanner.';
    // Cada botón de elemento con cuántas cargas tiene en la obra elegida: el que no tiene se ve en 0.
    var obra = est.buscadorObra ? est.buscadorObra.getId() : '';
    var cuenta = { '': 0 };
    est.cargas.forEach(function (c) {
      if (obra && c.obra !== obra) return;
      cuenta[''] += 1;
      (c.elemento || '').split(', ').forEach(function (el) { cuenta[el] = (cuenta[el] || 0) + 1; });
    });
    document.querySelectorAll('#ascElemento .arm-button').forEach(function (b) {
      var el = b.getAttribute('data-el') || '';
      b.textContent = (el || 'Todos') + ' ' + (cuenta[el] || 0);
    });
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
    est.sinRespuesta = !d;
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
  }

  // ── Planos (20-nov): el avance de cada plano guardado desde ArmaScanner ──
  function decimal(n) { return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('es-CL'); }

  async function postPlano(ruta, p) {
    var res = await fetch(global.apiUrl(ruta), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, global.authHeaders()),
      body: JSON.stringify({ obra: p.obra, plano: p.plano })
    });
    if (res.status === 401) { global.logout(); return null; }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) { global.showToast((data.detail || 'Error ' + res.status), 'error'); return null; }
    return data;
  }

  function planosFiltrados() {
    var obra = est.buscadorPlanos ? est.buscadorPlanos.getId() : '';
    return est.planos.filter(function (p) {
      return (!obra || p.obra === obra) && (!est.plElemento || (p.elemento || '').split(', ').indexOf(est.plElemento) !== -1);
    });
  }

  function pintarPlanos() {
    var filas = planosFiltrados();
    var edicion = 0, barras = 0, aprob = 0, consultas = 0;
    var html = filas.map(function (p) {
      var i = est.planos.indexOf(p);
      var r = p.resumen || {};
      var total = Number(r.barras) || 0, ok = Number(r.aprobadas) || 0;
      if (p.en_edicion_por) edicion += 1;
      barras += total; aprob += ok; consultas += Number(r.consultas) || 0;
      var pct = total ? Math.round(100 * ok / total) : 0;
      var estado = !p.en_edicion_por ? '<span class="arm-tag">' + (p.etapa === 'cargado' ? 'Cargado' : 'Disponible') + '</span>'
        : (p.en_edicion_por_mi ? '<span class="arm-tag arm-tag--success">En edición por ti</span>'
          : '<span class="arm-tag arm-tag--warning">En edición por ' + esc(p.en_edicion_por) + '</span>') +
          (p.en_edicion_desde ? '<div class="asc-linea">' + esc(p.en_edicion_desde) + '</div>' : '');
      var pedido = p.pedido === 'enviado'
        ? '<span class="arm-tag arm-tag--success">Enviado</span>' +
          '<div class="asc-linea">' + esc(p.pedido_el) + (p.pedido_version ? ' · v' + esc(p.pedido_version) : '') + '</div>'
        : p.pedido === 'cambios' ? '<span class="arm-tag arm-tag--warning">Cambios sin enviar</span>'
        : '<span class="arm-tag">Sin enviar</span>';
      var acciones = '<button class="arm-button" onclick="ascVerBarras(' + i + ')">Ver barras</button>' +
        (p.puede_enviar && total > 0
          ? ' <button class="arm-button arm-button--primary" onclick="ascEnviarPedido(' + i + ')">Enviar pedido</button>' : '') +
        (p.puede_liberar
          ? ' <button class="arm-button arm-button--danger" onclick="ascLiberarPlano(' + i + ')">Liberar</button>' : '') +
        (p.puede_eliminar
          ? ' <button class="arm-button arm-button--danger" onclick="ascEliminarPlano(' + i + ')">Eliminar</button>' : '');
      return '<tr>' +
        '<td>' + esc(p.obra_nombre) + '</td>' +
        '<td class="corto" title="' + esc(p.plano) + '">' + esc(p.numero || p.plano) + '</td>' +
        '<td class="corto" title="' + esc(p.titulo) + '">' + esc(p.titulo) + '</td>' +
        '<td>' + esc(p.elemento) + '</td>' +
        '<td>v' + esc(p.version) + '</td>' +
        '<td style="white-space:nowrap;">' + entero(ok) + ' / ' + entero(total) +
          '<div class="asc-avance" title="' + pct + ' %"><div style="width:' + pct + '%;"></div></div></td>' +
        '<td class="num">' + entero(r.consultas) + '</td>' +
        '<td class="num">' + entero(r.pendientes) + '</td>' +
        '<td class="num">' + entero(r.kg) + '</td>' +
        '<td>' + estado + '</td>' +
        '<td>' + pedido + '</td>' +
        '<td>' + esc(quien(p.guardado_por)) + '<div class="asc-linea">' + esc(p.guardado_el) + '</div></td>' +
        '<td class="asc-acciones">' + acciones + '</td></tr>';
    }).join('');
    document.getElementById('ascPlanos').innerHTML = html;
    var vacio = document.getElementById('ascPlanosVacio');
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = est.plSinRespuesta ? 'No se pudieron leer los planos. Recarga la página.'
      : est.planos.length ? 'Sin planos con este filtro.' : 'Sin planos guardados desde ArmaScanner.';
    var obra = est.buscadorPlanos ? est.buscadorPlanos.getId() : '';
    var cuenta = { '': 0 };
    est.planos.forEach(function (p) {
      if (obra && p.obra !== obra) return;
      cuenta[''] += 1;
      (p.elemento || '').split(', ').forEach(function (el) { cuenta[el] = (cuenta[el] || 0) + 1; });
    });
    document.querySelectorAll('#ascPlElemento .arm-button').forEach(function (b) {
      var el = b.getAttribute('data-el') || '';
      b.textContent = (el || 'Todos') + ' ' + (cuenta[el] || 0);
    });
    poner('ascPlKpiPlanos', entero(filas.length));
    poner('ascPlKpiEdicion', entero(edicion));
    poner('ascPlKpiAprob', entero(aprob) + ' de ' + entero(barras) + ' · ' + (barras ? Math.round(100 * aprob / barras) : 0) + ' %');
    poner('ascPlKpiConsulta', entero(consultas));
  }

  async function cargarPlanos() {
    if (!est.buscadorPlanos && global.BuscadorObra) {
      est.buscadorPlanos = global.BuscadorObra.crear({
        inputId: 'ascPlObraInput', datalistId: 'ascPlObraDatalist', selectId: 'ascPlObraSelect',
        onElegir: function () { pintarPlanos(); }
      });
      document.getElementById('ascBarrasCerrar').addEventListener('click', cerrarBarras);
      document.getElementById('ascBarrasModal').addEventListener('click', function (ev) {
        if (ev.target === this) cerrarBarras();
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && global.isModalOpen && global.isModalOpen('ascBarrasModal')) cerrarBarras();
      });
    }
    var d = await global.apiGet('/armascanner/planos-linea');
    est.planos = (d && d.planos) || [];
    est.plSinRespuesta = !d;
    var vistas = {};
    var obras = [];
    est.planos.forEach(function (p) {
      if (!vistas[p.obra]) { vistas[p.obra] = 1; obras.push({ id: p.obra, nombre: p.obra_nombre }); }
    });
    if (est.buscadorPlanos) est.buscadorPlanos.setProyectos(obras);
    var sel = document.getElementById('ascPlObraSelect');
    var elegida = sel.value;
    sel.innerHTML = '<option value=""></option>' + obras.map(function (o) {
      return '<option value="' + esc(o.id) + '">' + esc(o.nombre) + '</option>';
    }).join('');
    sel.value = vistas[elegida] ? elegida : '';  // al recargar tras enviar o liberar, la obra elegida se mantiene
    pintarPlanos();
    cargarReportes();
  }

  // Ver barras: ventana con la lista del plano; abre en «Con consulta» si hay alguna (se manda
  // por correo como pantallazo: título y tabla sin controles).
  var REV = {
    aprobada: { txt: 'Aprobada', tag: 'arm-tag arm-tag--success' },
    duda: { txt: 'Con consulta', tag: 'arm-tag arm-tag--warning' },
    pendiente: { txt: 'Por aprobar', tag: 'arm-tag' }
  };
  var FILTROS_REV = [['', 'Todas'], ['duda', 'Con consulta'], ['pendiente', 'Por aprobar'], ['aprobada', 'Aprobadas']];

  function revDe(b) { return REV[b.rev] ? b.rev : 'pendiente'; }

  function pintarBarras() {
    var v = est.verBarras;
    if (!v) return;
    var cuenta = { '': v.barras.length, aprobada: 0, duda: 0, pendiente: 0 };
    v.barras.forEach(function (b) { cuenta[revDe(b)] += 1; });
    document.getElementById('ascBarrasFiltro').innerHTML = FILTROS_REV.map(function (f) {
      return '<button class="arm-button' + (f[0] === v.filtro ? ' is-on' : '') + '" data-rev="' + f[0] + '">' +
        f[1] + ' ' + entero(cuenta[f[0]]) + '</button>';
    }).join('');
    var filas = v.barras.filter(function (b) { return !v.filtro || revDe(b) === v.filtro; });
    var nombreFiltro = FILTROS_REV.filter(function (f) { return f[0] === v.filtro; })[0][1];
    document.getElementById('ascBarrasTitulo').textContent =
      (v.plano.numero || v.plano.plano) + ' — ' + (v.plano.obra_nombre || v.plano.obra) +
      (v.version ? ' · v' + v.version : '') + ' · ' + nombreFiltro;
    document.getElementById('ascBarras').innerHTML = filas.map(function (b) {
      var r = REV[revDe(b)];
      return '<tr><td>' + esc(b.id) + '</td><td>' + esc(b.marca) + '</td>' +
        '<td class="num">' + esc(b.diam) + '</td><td class="num">' + (b.cant == null ? '' : entero(b.cant)) + '</td>' +
        '<td class="num">' + (b.largo == null ? '' : entero(b.largo)) + '</td>' +
        '<td class="num">' + (b.kg == null ? '' : decimal(b.kg)) + '</td>' +
        '<td>' + esc(b.ciclo) + '</td><td>' + esc(b.eje) + '</td>' +
        '<td><span class="' + r.tag + '">' + r.txt + '</span></td><td>' + esc(b.motivo) + '</td></tr>';
    }).join('');
    var vacio = document.getElementById('ascBarrasVacio');
    vacio.style.display = filas.length ? 'none' : '';
    vacio.textContent = v.barras.length ? 'Sin barras con este filtro.' : 'Sin barras en la versión guardada.';
  }

  function cerrarBarras() {
    est.verBarras = null;
    global.hideModal('ascBarrasModal');
  }

  global.ascVerBarras = async function (i) {
    var p = est.planos[i];
    if (!p) return;
    var d = await global.apiGet('/armascanner/planos-linea/barras?obra=' + encodeURIComponent(p.obra) +
                                '&plano=' + encodeURIComponent(p.plano));
    if (!d) { global.showToast('No se pudieron leer las barras del plano.', 'error'); return; }
    var barras = d.barras || [];
    est.verBarras = { plano: p, version: d.version, barras: barras,
                      filtro: barras.some(function (b) { return b.rev === 'duda'; }) ? 'duda' : '' };
    pintarBarras();
    global.showModal('ascBarrasModal');
  };

  global.ascEnviarPedido = async function (i) {
    var p = est.planos[i];
    if (!p) return;
    var r = p.resumen || {};
    var sin = (Number(r.pendientes) || 0) + (Number(r.consultas) || 0);
    var texto = '¿Enviar pedido de ' + (p.numero || p.plano) + '?\n\nLas barras de la versión v' + p.version +
      ' pasan a los despieces de la obra. Reemplazan las de este plano.' +
      (sin > 0 ? '\n\n' + entero(sin) + ' barras sin aprobar: esas combinaciones no se exportan.' : '');
    if (!confirm(texto)) return;
    var data = await postPlano('/armascanner/planos-linea/pedido', p);
    if (!data) return;
    global.showToast('Pedido enviado: ' + entero(data.barras) + ' barras · ' + entero(data.kilos) + ' kg', 'success');
    await cargarPlanos();
  };

  global.ascLiberarPlano = async function (i) {
    var p = est.planos[i];
    if (!p) return;
    var texto = '¿Liberar ' + (p.numero || p.plano) + '?' + (p.en_edicion_por_mi ? ''
      : '\n\nEstá en edición por ' + p.en_edicion_por + '. Lo que no haya guardado queda sólo en su equipo.');
    if (!confirm(texto)) return;
    if (await postPlano('/armascanner/planos-linea/liberar', p)) {
      global.showToast('Plano liberado.', 'success');
      await cargarPlanos();
    }
  };

  global.ascEliminarPlano = async function (i) {
    var p = est.planos[i];
    if (!p) return;
    var texto = '¿Eliminar ' + (p.numero || p.plano) + ' de ArmaHub?\n\nSe borran su registro y su copia guardada (v' +
      p.version + ').' + (p.en_edicion_por ? ' Está en edición por ' + p.en_edicion_por + '.' : '');
    if (!confirm(texto)) return;
    var conBarras = p.pedido !== 'sin_enviar' && confirm('Este plano envió un pedido. ¿Eliminar también sus barras de los ' +
      'despieces de la obra?\n\nAceptar: se eliminan. Cancelar: las barras se conservan.');
    var data = await global.apiPost('/armascanner/planos-linea/eliminar', { obra: p.obra, plano: p.plano, con_barras: conBarras });
    if (!data) return;
    global.showToast('Plano eliminado' + (data.barras_eliminadas ? ' · ' + entero(data.barras_eliminadas) + ' barras' : '') + '.', 'success');
    await cargarPlanos();
  };

  // ── Reportes (administrador): lo que el cubicador manda desde ArmaScanner con «Enviar reporte» ──
  async function cargarReportes() {
    var card = document.getElementById('ascReportesCard');
    if (!card) return;
    var data = await global.apiGet('/armascanner/reportes');
    if (!data) { card.style.display = 'none'; return; }
    card.style.display = '';
    var filas = data.reportes || [];
    document.getElementById('ascReportes').innerHTML = filas.map(function (r) {
      return '<tr><td>' + esc(r.el) + '</td><td>' + esc(r.usuario) + '</td><td>' + esc(r.equipo) + '</td><td>' + esc(r.version) +
        '</td><td>' + esc(r.obra) + (r.plano ? '<div class="asc-linea">' + esc(r.plano) + '</div>' : '') + '</td><td>' +
        esc(r.comentario) + '</td><td class="num">' + mb(r.tamano) + '</td><td>' +
        '<button class="arm-button" onclick="ascDescargarReporte(' + r.id + ')">Descargar</button></td></tr>';
    }).join('');
    document.getElementById('ascReportesVacio').style.display = filas.length ? 'none' : '';
  }

  global.ascDescargarReporte = async function (id) {
    var v = await global.apiGet('/armascanner/reportes/' + id + '/descarga');
    if (v && v.url) window.location.href = v.url;
  };

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
      : ['admin', 'admin_calidad'].indexOf(global.currentRole) !== -1
        ? 'Sin versión publicada. Se publica en la pestaña Versiones.' : 'Sin versión publicada.';
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
  // Lo mismo en Planos, y los filtros de revisión de la ventana de barras.
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#ascPlElemento .arm-button');
    if (b) {
      est.plElemento = b.getAttribute('data-el') || '';
      document.querySelectorAll('#ascPlElemento .arm-button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      pintarPlanos();
      return;
    }
    var f = ev.target.closest && ev.target.closest('#ascBarrasFiltro .arm-button');
    if (f && est.verBarras) {
      est.verBarras.filtro = f.getAttribute('data-rev') || '';
      pintarBarras();
    }
  });

  global.loadArmaScannerModule = function () {};  // cada pestaña carga lo suyo (shell.js, tabLoaders)
  global.ascCargarObras = cargarObras;
  global.ascCargarPlanos = cargarPlanos;
  global.ascCargarInstalar = cargarInstalar;
  global.ascCargarLicencias = cargarLicencias;
  global.ascCargarUso = cargarUso;
  global.ascCargarVersiones = cargarVersiones;
})(window);
