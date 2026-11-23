/* armascanner/licencias.js — la pestaña Licencias (administración): quién tiene la licencia de ArmaScanner;
 * darla, vencerla, quitarla, volver a darla y liberar un equipo. Usa las rutas de siempre: PUT
 * /admin/users/{id}/licencias/armascanner y POST …/liberar.
 */
(function (global) {
  'use strict';
  var A = global.Asc;
  var est = A.est, esc = A.esc, fecha = A.fecha;

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
    var html = est.licencias.map(function (l, i) { return filaLicencia(l, i, hoy); }).join('');
    document.getElementById('ascLicencias').innerHTML = html;
    document.getElementById('ascLicenciasVacio').style.display = est.licencias.length ? 'none' : '';
  }

  function filaLicencia(l, i, hoy) {
    return '<tr>' +
      '<td><div>' + esc(l.nombre) + '</div><div class="asc-linea">' + esc(l.email) + '</div></td>' +
      '<td>' + estadoLicencia(l, hoy) + '</td>' +
      '<td><input type="date" class="arm-input" value="' + esc(l.vence || '') + '"' + (l.activa ? '' : ' disabled') +
        ' onchange="ascVencimiento(' + i + ', this.value)" style="min-height:30px;"></td>' +
      '<td>' + equiposLicencia(l, i) + '<div class="asc-linea">' + (l.equipos || []).length + ' de ' + (l.max_equipos || 2) + '</div></td>' +
      '<td>' + fecha(l.ultimo_uso) + '</td>' +
      '<td style="text-align:right;">' + (l.activa
        ? '<button class="arm-button arm-button--danger" onclick="ascQuitar(' + i + ')">Quitar</button>'
        : '<button class="arm-button" onclick="ascDarDeNuevo(' + i + ')">Activar</button>') + '</td></tr>';
  }

  function estadoLicencia(l, hoy) {
    var vencida = l.activa && l.vence && l.vence < hoy;
    return !l.activa ? '<span class="arm-tag">Retirada</span>'
      : vencida ? '<span class="arm-tag arm-tag--danger">Vencida</span>'
      : '<span class="arm-tag arm-tag--success">Activa</span>';
  }

  function equiposLicencia(l, i) {
    return (l.equipos || []).map(function (e, k) {
      return '<div style="display:flex; align-items:center; gap:6px; margin:2px 0;">' + esc(e.equipo) +
        ' <button class="arm-button" style="min-height:24px; padding:0 8px; font-size:12px;"' +
        ' onclick="ascLiberar(' + i + ',' + k + ')">Liberar</button></div>';
    }).join('') || '<span class="asc-linea">—</span>';
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

  A.cargarLicencias = cargarLicencias;
})(window);
