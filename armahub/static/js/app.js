// ArmaHub — Main Application JavaScript
// Core bootstrap: loadMe + init + global safety handlers.
// Feature code lives in features/*/ and legacy bridges in legacy/compat.js.

// ========================= ESTILOS PARA LAZY LOADING =========================
if (!document.getElementById('lazyLoadingStyles')) {
  var style = document.createElement('style');
  style.id = 'lazyLoadingStyles';
  style.textContent = `
    @keyframes loading {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(style);
}

// ========================= CORE =========================

async function loadMe() {
  const me = await loadCurrentSession();
  if (!me) return;

  if (typeof window.renderHubModules === 'function') {
    window.renderHubModules();
  }

  // Show Hub screen
  document.getElementById('hubScreen').style.display = 'block';

  // Status message
  const roleLabels = {admin:'ADMIN', admin_calidad:'Admin Calidad', jefe_servicio:'Jefe de Servicio', miembro:'Miembro', cliente:'Cliente', cubicador:'Cubicador', usc:'USC', externo:'Externo'};
  await setGlobalStatus("Sesión como " + (roleLabels[currentRole] || currentRole), "ok");

  // Load landing flash indicators
  if (typeof loadLandingIndicadores === 'function') {
    loadLandingIndicadores();
  }

  // Load notification count (bell badge + hub card)
  if (typeof loadNotifCount === 'function') {
    loadNotifCount();
  }
}

// ========================= GLOBAL SAFETY =========================

// Prevent browser from opening files dropped outside the drop zone
document.addEventListener('dragover', function(e) { e.preventDefault(); });
document.addEventListener('drop', function(e) { e.preventDefault(); });

// Block all paste events to prevent image duplication
document.addEventListener('paste', function(e) {
  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
  }
}, true);

// ========================= INIT =========================

(async function init() {
  if (!ensureAuthenticatedSession()) return;
  await loadMe();

  // Restaurar posición exacta (módulo + tab + sub-tab) desde el hash de la
  // URL. Así F5 no devuelve siempre al hub: switchModule/switchTab/
  // switchRecSubTab escriben este mismo formato en cada navegación.
  var hash = window.location.hash.substring(1);
  var params = {};
  hash.split('&').forEach(function(part) {
    var eq = part.indexOf('=');
    if (eq === -1) return;
    params[part.substring(0, eq)] = part.substring(eq + 1);
  });

  if (params.mod && typeof window.switchModule === 'function') {
    // Restaurar posición tras F5: switchModule abre DIRECTO el tab guardado
    // (segundo parámetro), sin pasar por el defaultTab y saltar después.
    // El sub-tab Nivel 2 (params.sub) lo restaura el propio módulo leyendo esta
    // variable, para abrir en el sub-tab correcto sin parpadeo. Se consume una vez.
    if (params.sub) window.__armahubRecSubTabPendiente = params.sub;
    await window.switchModule(params.mod, params.tab || null);
  }
})();
