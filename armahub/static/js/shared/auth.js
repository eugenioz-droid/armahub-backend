(function(global) {
  var currentRole = 'usc';
  var currentUserEmail = '';
  var currentUserName = '';

  function syncSessionState(me) {
    var displayName = ((me.nombre || '') + ' ' + (me.apellido || '')).trim();
    currentRole = me.role || 'usc';
    currentUserEmail = me.email || '';
    currentUserName = displayName || me.email || '';
    localStorage.setItem('armahub_email', currentUserEmail);
    global.currentRole = currentRole;
    global.currentUserEmail = currentUserEmail;
    global.currentUserName = currentUserName;
    return {
      role: currentRole,
      email: currentUserEmail,
      displayName: currentUserName,
      raw: me
    };
  }

  function renderSessionIdentity(me) {
    var whoEmail = document.getElementById('whoEmail');
    var whoRole = document.getElementById('whoRole');
    if (whoEmail) whoEmail.textContent = currentUserName || me.email || '—';
    if (whoRole) whoRole.textContent = 'Rol: ' + (currentRole || '—');
  }

  async function loadCurrentSession() {
    var me = await apiGet('/me');
    if (!me) return null;
    syncSessionState(me);
    renderSessionIdentity(me);
    return me;
  }

  function ensureAuthenticatedSession() {
    if (!token()) {
      window.location.href = '/ui/login';
      return false;
    }
    return true;
  }

  function getSessionState() {
    return {
      role: currentRole,
      email: currentUserEmail,
      displayName: currentUserName
    };
  }

  async function cambiarMiClave() {
    var currentPass = prompt('Contraseña actual:');
    if (!currentPass) return;
    var newPass = prompt('Nueva contraseña (mín. 6 caracteres):');
    if (!newPass) return;
    if (newPass.length < 6) {
      alert('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    var confirmPass = prompt('Confirmar nueva contraseña:');
    if (confirmPass !== newPass) {
      alert('Las contraseñas no coinciden');
      return;
    }
    var params = new URLSearchParams({ current_password: currentPass, new_password: newPass });
    var res = await fetch('/me/password?' + params.toString(), { method: 'POST', headers: authHeaders() });
    if (res.status === 401) {
      alert('Contraseña actual incorrecta');
      return;
    }
    var data = await res.json();
    if (data.ok) {
      alert('Contraseña actualizada correctamente');
    } else {
      alert('Error: ' + (data.detail || 'desconocido'));
    }
  }

  global.currentRole = currentRole;
  global.currentUserEmail = currentUserEmail;
  global.currentUserName = currentUserName;
  global.loadCurrentSession = loadCurrentSession;
  global.ensureAuthenticatedSession = ensureAuthenticatedSession;
  global.getSessionState = getSessionState;
  global.cambiarMiClave = cambiarMiClave;
  global.ArmaHubAuth = {
    loadCurrentSession: loadCurrentSession,
    ensureAuthenticatedSession: ensureAuthenticatedSession,
    getSessionState: getSessionState,
    cambiarMiClave: cambiarMiClave,
    syncSessionState: syncSessionState,
    renderSessionIdentity: renderSessionIdentity
  };
})(window);