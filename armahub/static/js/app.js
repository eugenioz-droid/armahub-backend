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
  const roleLabels = {admin:'ADMIN', admin_calidad:'Admin Calidad', cubicador:'Cubicador', usc:'USC', externo:'Externo', cliente:'Cliente'};
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

  // Restore tab from hash
  var hash = window.location.hash.substring(1);
  if (hash === 'presentaciones') {
    await waitForReclamosFeatureReady();
    if (typeof window.switchRecSubTab === 'function') {
      window.switchRecSubTab('presentaciones');
    }
  }
})();
