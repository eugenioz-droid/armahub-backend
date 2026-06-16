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

  // Lee el sub-tab guardado en el hash (#mod=reclamos&...&sub=xxx). Devuelve
  // null si no hay. Lo usa el montaje del módulo para abrir directo en el
  // sub-tab correcto tras F5, sin pasar por 'clientes' primero.
  function _leerSubTabDelHash() {
    var hash = (window.location.hash || '').substring(1);
    var sub = null;
    hash.split('&').forEach(function(part) {
      var eq = part.indexOf('=');
      if (eq !== -1 && part.substring(0, eq) === 'sub') sub = part.substring(eq + 1);
    });
    return sub;
  }

  // --- Module entry point ---
  async function _loadReclamosModule() {
    // 1) Visibilidad de los 5 botones de sub-tab según rol — síncrono, antes
    //    de cualquier await, para que los títulos aparezcan de inmediato.
    if (typeof _applyRecSubTabsVisibility === 'function') _applyRecSubTabsVisibility();

    // 2) Activar de una vez el sub-tab destino ANTES de cargar datos, para que
    //    no se vea 'clientes' y luego un salto al sub-tab real (sin parpadeo).
    //    Prioridad: variable pendiente que dejó app.js en F5 (el hash ya pudo
    //    ser reescrito por switchTab), luego el hash, luego 'clientes'. switch
    //    cae a 'clientes' solo si el destino no es visible para el rol.
    if (typeof global.switchRecSubTab === 'function') {
      var subDestino = global.__armahubRecSubTabPendiente || _leerSubTabDelHash() || 'clientes';
      global.__armahubRecSubTabPendiente = null;
      global.switchRecSubTab(subDestino);
    }

    if (typeof global.loadProyectos === 'function') {
      await Promise.resolve(global.loadProyectos());
    }
    await Promise.resolve(loadRecUsersDropdown());
    populateRecFilterProyecto();
    await Promise.resolve(loadReclamos());
    await Promise.resolve(loadRecLanding());
    _initRecImageDropZonesGuarded();

    // Mostrar/ocultar el formulario de crear reclamo según la config configurable
    // (reclamo_crear_config), no por rol hardcodeado. El backend es la fuente de
    // verdad; aquí solo decidimos la visibilidad del formulario.
    var crearCard = document.getElementById('crearReclamoCard');
    if (crearCard) {
      try {
        var perm = await Promise.resolve(apiGet('/reclamos/puedo-crear?tipo=externo'));
        crearCard.style.display = (perm && perm.puede) ? '' : 'none';
      } catch (e) {
        // Fallback conservador si falla la consulta: ocultar para roles no-staff.
        if (['cliente','externo'].includes(currentRole)) crearCard.style.display = 'none';
      }
    }
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
    'switchRecSubTab',
    'loadRecLanding',
    'loadRecAdminDashboards',
    'loadRecUsersDropdown',
    'populateRecFilterProyecto',
    'loadReclamos',
    'limpiarFiltrosReclamos',
    'toggleNuevoReclamo',
    'crearReclamo',
    'loadReclamosInternos',
    'initInternosForm',
    'toggleNuevoInterno',
    'crearReclamoInterno',
    'toggleIntAbierto',
    'toggleIntScope',
    'toggleIntAplica',
    'limpiarFiltrosInternos',
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
    'aprobarParaValidacion',
    'devolverRevisionDesdeModal',
    'reabrirReclamo',
    'loadRecValidaciones',
    'verReclamo',
    'toggleRecAplica',
    'toggleRecAbierto',
    'toggleEditarReclamo',
    'guardarEdicionReclamo',
    'toggleEditarReclamoInterno',
    'guardarEdicionReclamoInterno',
    'guardarAnioNumeroCalidad',
    'cambiarProyectoReclamo',
    'cambiarAsignadoAReclamo',
    'loadUsuariosUsc',
    'cambiarAplicaReclamo',
    'guardarRespuesta',
    'aprobarValidacionDesdeModal',
    'devolverValidacionDesdeModal',
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
