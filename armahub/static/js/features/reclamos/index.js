// ArmaHub Reclamos — Orchestrator (PC.17)
// Functions split into: constants.js, helpers.js, presentaciones.js,
// dashboards.js, list.js, form.js, detail.js

(function(global) {
  if (global.__armahubReclamosFeatureLoaded) {
    if (typeof global.__armahubResolveReclamosFeatureReady === 'function') {
      global.__armahubResolveReclamosFeatureReady(global.ArmaHubReclamosFeature || null);
      global.__armahubResolveReclamosFeatureReady = null;
      global.__armahubRejectReclamosFeatureReady = null;
    }
    return;
  }
  global.__armahubReclamosFeatureLoaded = true;

  var api = {};

  function resolveReady(value) {
    if (typeof global.__armahubResolveReclamosFeatureReady === 'function') {
      global.__armahubResolveReclamosFeatureReady(value);
      global.__armahubResolveReclamosFeatureReady = null;
      global.__armahubRejectReclamosFeatureReady = null;
    }
  }

  // --- Module entry point ---
  async function _loadReclamosModule() {
    if (typeof global.loadProyectos === 'function') {
      await Promise.resolve(global.loadProyectos());
    }
    await Promise.resolve(loadRecUsersDropdown());
    populateRecFilterProyecto();
    await Promise.resolve(loadReclamos());
    await Promise.resolve(loadRecLanding());
    _initRecImageDropZonesGuarded();

    // Ocultar card de crear reclamo para cliente, cubicador y externo
    var crearCard = document.getElementById('crearReclamoCard');
    if (crearCard && ['cliente','cubicador','externo'].includes(currentRole)) crearCard.style.display = 'none';
  }

  // --- Drop zones initializer with dedup guard ---
  var _origInitRecImageDropZones = global.initRecImageDropZones;
  function _initRecImageDropZonesGuarded() {
    if (global.__armahubReclamosDropZonesInitialized) return;
    _origInitRecImageDropZones();
    // Solo marcar como inicializado si la zona principal existe en el DOM
    if (document.getElementById('recCreateDropZone')) {
      global.__armahubReclamosDropZonesInitialized = true;
    }
  }

  // --- Build API: all functions are file-scope, reference directly ---
  var allExports = [
    'switchRecTab',
    'loadRecLanding',
    'loadRecAdminDashboards',
    'loadRecUsersDropdown',
    'populateRecFilterProyecto',
    'loadReclamos',
    'limpiarFiltrosReclamos',
    'toggleNuevoReclamo',
    'crearReclamo',
    'toggleNuevoProyectoRec',
    'crearProyectoDesdeReclamo',
    'toggleRecNewCalc',
    'crearCalcDesdeRecForm',
    'toggleRecNewConst',
    'crearConstDesdeRecForm',
    'verReclamo',
    'renderAcciones',
    'renderImagenesEnContainer',
    'renderReclamoTimeline',
    'cerrarReclamo',
    'reabrirReclamo',
    'toggleEditarReclamo',
    'guardarEdicionReclamo',
    'guardarAnioNumeroCalidad',
    'cambiarProyectoReclamo',
    'cambiarAsignadoAReclamo',
    'loadUsuariosUsc',
    'cambiarAplicaReclamo',
    'guardarRespuesta',
    'guardarValidacion',
    'agregarAccion',
    'limpiarFormularioAcciones',
    'eliminarAccion',
    'eliminarImagen',
    'agregarSeguimiento',
    'eliminarReclamo',
    'abrirIshikawaModal',
    'seleccionarIshikawa',
    'confirmarIshikawa',
    'cerrarIshikawaModal',
    'openReclamoModal',
    'closeReclamoModal',
    'recNavPrevReclamo',
    'recNavNextReclamo',
    'loadPresentaciones',
    'togglePresSection',
    'presNavPrev',
    'presNavNext',
    'seleccionarReclamoPres',
    'guardarPresentacion',
    'loadPresStats',
    'descargarPdfReclamo'
  ];

  allExports.forEach(function(name) {
    if (typeof global[name] === 'function') {
      api[name] = global[name];
    }
  });

  // Override wrapped versions
  api.loadReclamosModule = _loadReclamosModule;
  api.initRecImageDropZones = _initRecImageDropZonesGuarded;
  global.loadReclamosModule = _loadReclamosModule;
  global.initRecImageDropZones = _initRecImageDropZonesGuarded;

  global.ArmaHubReclamosFeature = api;
  resolveReady(api);
})(window);
