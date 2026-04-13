// ArmaHub — Legacy compatibility wrappers
// Bridges that exist until features fully own their entry points.
// Created in E.6; remove once registry.js invokes features directly.

// ── Reclamos bridge ──────────────────────────────────────────

async function waitForReclamosFeatureReady() {
  var featureReady = window.__armahubReclamosFeatureReady;
  if (featureReady && typeof featureReady.then === 'function') {
    try {
      await featureReady;
    } catch (error) {
      console.warn('[ArmaHub] Reclamos feature unavailable, using legacy fallback.', error);
    }
  }
}

async function loadReclamosModule() {
  await waitForReclamosFeatureReady();
  if (
    window.ArmaHubReclamosFeature &&
    typeof window.ArmaHubReclamosFeature.loadReclamosModule === 'function' &&
    window.ArmaHubReclamosFeature.loadReclamosModule !== loadReclamosModule
  ) {
    return window.ArmaHubReclamosFeature.loadReclamosModule();
  }
  await loadProyectos();
  await loadRecUsersDropdown();
  populateRecFilterProyecto();
  await loadReclamos();
  await loadRecLanding();
  initRecImageDropZones();
}
