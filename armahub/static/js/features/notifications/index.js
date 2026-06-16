// ========================= NOTIFICACIONES — Centro de notificaciones in-app =========================
// Bell icon dropdown + hub card + admin config

(function(global) {
  'use strict';

  // ========================= BELL: COUNT + BADGE =========================

  async function loadNotifCount() {
    try {
      var data = await apiGet('/notificaciones/count');
      if (!data) return;
      var count = data.count || 0;
      var badge = document.getElementById('notifBadge');
      if (badge) {
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : count;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
      // Hub card
      var hubCard = document.getElementById('hubNotificaciones');
      var hubTexto = document.getElementById('hubNotifTexto');
      var hubDetalle = document.getElementById('hubNotifDetalle');
      if (hubCard) {
        if (count > 0) {
          hubCard.style.display = '';
          if (hubTexto) hubTexto.textContent = 'Tienes ' + count + ' notificación' + (count !== 1 ? 'es' : '') + ' sin leer';
          if (hubDetalle) hubDetalle.textContent = 'Haz clic para ver tus notificaciones';
        } else {
          hubCard.style.display = 'none';
        }
      }
    } catch (e) {
      // silent
    }
  }

  // ========================= BELL: TOGGLE PANEL =========================

  var _notifPanelOpen = false;

  function toggleNotifPanel() {
    var panel = document.getElementById('notifPanel');
    if (!panel) return;
    _notifPanelOpen = !_notifPanelOpen;
    panel.style.display = _notifPanelOpen ? 'block' : 'none';
    if (_notifPanelOpen) {
      loadNotifList();
    }
  }

  // Close panel on click outside
  document.addEventListener('click', function(e) {
    if (!_notifPanelOpen) return;
    var wrap = document.getElementById('notifBellWrap');
    if (wrap && !wrap.contains(e.target)) {
      var hubCard = document.getElementById('hubNotificaciones');
      if (hubCard && hubCard.contains(e.target)) return;
      _notifPanelOpen = false;
      var panel = document.getElementById('notifPanel');
      if (panel) panel.style.display = 'none';
    }
  });

  // ========================= BELL: LIST =========================

  async function loadNotifList() {
    var container = document.getElementById('notifList');
    if (!container) return;
    container.innerHTML = '<div class="muted" style="padding:20px; text-align:center; font-size:12px;">Cargando...</div>';
    try {
      var data = await apiGet('/notificaciones?limit=30');
      if (!data || !data.data || data.data.length === 0) {
        container.innerHTML = '<div class="muted" style="padding:20px; text-align:center; font-size:12px;">Sin notificaciones</div>';
        return;
      }
      var html = '';
      data.data.forEach(function(n) {
        var bg = n.leida ? '#fff' : '#f3f8ff';
        var dot = n.leida ? '' : '<span style="display:inline-block; width:8px; height:8px; background:#1976d2; border-radius:50%; margin-right:6px; flex-shrink:0;"></span>';
        var fecha = _formatNotifFecha(n.fecha);
        html += '<div class="notif-item" style="display:flex; align-items:flex-start; gap:4px; padding:8px 14px; background:' + bg + '; border-bottom:1px solid #f0f0f0; cursor:pointer;" '
              + 'onclick="clickNotif(' + n.id + ',' + (n.reclamo_id || 'null') + ',' + n.leida + ')">'
              + dot
              + '<div style="flex:1; min-width:0;">'
              + '<div style="font-size:12px; color:#333; line-height:1.4;">' + _escHtml(n.mensaje) + '</div>'
              + '<div style="font-size:10px; color:#999; margin-top:2px;">' + _escHtml(n.tipo_label) + ' · ' + fecha + '</div>'
              + '</div></div>';
      });
      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = '<div class="muted" style="padding:20px; text-align:center; font-size:12px;">Error al cargar</div>';
    }
  }

  function _formatNotifFecha(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var now = new Date();
      var diff = now - d;
      if (diff < 60000) return 'Ahora';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' min';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
      return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
    } catch (e) {
      return iso.substring(0, 10);
    }
  }

  function _escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ========================= ACTIONS =========================

  async function clickNotif(notifId, reclamoId, leida) {
    // Mark as read
    if (!leida) {
      try {
        await fetch(apiUrl('/notificaciones/' + notifId + '/leer'), {
          method: 'PATCH', headers: authHeaders()
        });
      } catch (e) { /* silent */ }
    }
    // Navigate to reclamo if linked
    if (reclamoId) {
      _notifPanelOpen = false;
      var panel = document.getElementById('notifPanel');
      if (panel) panel.style.display = 'none';
      if (typeof switchModule === 'function') switchModule('reclamos');
      // Wait for tab to render, then open detail
      setTimeout(function() {
        if (typeof verDetalleReclamo === 'function') verDetalleReclamo(reclamoId);
      }, 400);
    }
    loadNotifCount();
    loadNotifList();
  }

  async function marcarTodasLeidas() {
    try {
      await fetch(apiUrl('/notificaciones/leer-todas'), {
        method: 'POST', headers: authHeaders()
      });
      loadNotifCount();
      loadNotifList();
      if (typeof showToast === 'function') showToast('Notificaciones marcadas como leídas', 'success');
    } catch (e) { /* silent */ }
  }

  // ========================= ADMIN: CONFIG =========================

  async function loadNotifConfig() {
    var container = document.getElementById('notifConfigContainer');
    if (!container) return;
    container.innerHTML = '<div class="muted">Cargando configuración...</div>';
    try {
      var data = await apiGet('/notificaciones/config');
      if (!data || !data.data) {
        container.innerHTML = '<div class="muted">Error al cargar configuración</div>';
        return;
      }
      var tipos = data.tipos_evento || [];
      var labels = data.labels || {};
      var roles = ['admin', 'admin_calidad', 'usc', 'miembro', 'jefe_servicio', 'externo'];
      var configMap = {};
      data.data.forEach(function(c) {
        configMap[c.tipo_evento + '|' + c.rol] = c.activo;
      });

      var html = '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
      html += '<thead><tr style="background:#f5f5f5;"><th style="text-align:left; padding:6px 8px;">Evento</th>';
      roles.forEach(function(r) {
        html += '<th style="text-align:center; padding:6px 4px;">' + r + '</th>';
      });
      html += '</tr></thead><tbody>';
      tipos.forEach(function(tipo) {
        html += '<tr style="border-bottom:1px solid #eee;">';
        html += '<td style="padding:6px 8px; font-weight:500;">' + _escHtml(labels[tipo] || tipo) + '</td>';
        roles.forEach(function(r) {
          var key = tipo + '|' + r;
          var checked = configMap[key] !== undefined ? configMap[key] : false;
          html += '<td style="text-align:center; padding:6px 4px;">';
          html += '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="toggleNotifConfig(\'' + tipo + '\',\'' + r + '\', this.checked)">';
          html += '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = '<div class="muted">Error al cargar configuración</div>';
    }
  }

  async function toggleNotifConfig(tipoEvento, rol, activo) {
    try {
      var res = await fetch(apiUrl('/notificaciones/config'), {
        method: 'PATCH',
        headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
        body: JSON.stringify({ tipo_evento: tipoEvento, rol: rol, activo: activo })
      });
      var data = await res.json();
      if (data && data.ok) {
        if (typeof showToast === 'function') showToast('Configuración actualizada', 'success');
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Error al actualizar', 'error');
    }
  }

  // ========================= EXPORTS =========================
  global.loadNotifCount = loadNotifCount;
  global.toggleNotifPanel = toggleNotifPanel;
  global.clickNotif = clickNotif;
  global.marcarTodasLeidas = marcarTodasLeidas;
  global.loadNotifConfig = loadNotifConfig;
  global.toggleNotifConfig = toggleNotifConfig;

})(window);
