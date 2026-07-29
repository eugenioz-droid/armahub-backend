(function initArmaHubShell() {
  if (window.__armahubShellLoaded) {
    return;
  }
  window.__armahubShellLoaded = true;

  var modulesLoaded = {};
  var registry = window.ArmaHubRegistry;
  var tabLabels = {
    inicio: 'Metrics',
    obras: 'Obras',
    buscar: 'Bar Manager',
    agregar: 'Agregar Cubicación',
    agregar2: 'Agregar Cubicación',
    pedidos: 'Pedidos',
    export: 'Exportacion',
    reclamos: 'Reclamos',
    rec_dashboards: 'Dashboards',
    rec_procedimientos: 'Procedimientos',
    rec_settings: 'Mailing',
    clientes: 'Clientes',
    catalogo: 'Catálogo',
    admin: 'Admin'
  };

  window.currentModule = 'hub';

  // Persistencia de navegación en el hash de la URL, para que F5 mantenga
  // la posición exacta (módulo + tab + sub-tab) en vez de volver siempre al
  // hub. Solo escribe el hash; quien restaura el estado al cargar la página
  // es app.js (init), que lee este mismo formato.
  function updateNavHash(mod, tab, sub) {
    var parts = [];
    if (mod && mod !== 'hub') parts.push('mod=' + mod);
    if (tab) parts.push('tab=' + tab);
    if (sub) parts.push('sub=' + sub);
    var newHash = parts.length ? '#' + parts.join('&') : '#';
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  }
  window.__armahubUpdateNavHash = updateNavHash;

  function callIfDefined(functionName) {
    if (typeof window[functionName] === 'function') {
      return window[functionName].apply(window, Array.prototype.slice.call(arguments, 1));
    }
    return undefined;
  }

  function createHubCard(moduleDefinition) {
    var accent = moduleDefinition.hubAccent || '#4285f4';
    var card = document.createElement('div');
    card.id = moduleDefinition.hubCardId || ('hubCard-' + moduleDefinition.id);
    card.style.cssText = 'cursor:pointer; background:#fff; border:2px solid #e0e0e0; border-radius:12px; padding:24px 20px; text-align:center; transition:all 0.2s; box-shadow:0 2px 8px rgba(0,0,0,0.06);';
    card.innerHTML =
      '<div style="font-size:36px; margin-bottom:10px;">' + (moduleDefinition.hubIcon || '🧩') + '</div>' +
      '<h3 style="margin:0 0 6px 0; color:#1a1a1a; font-size:16px; font-weight:700;">' + moduleDefinition.title + '</h3>' +
      '<p style="margin:0; color:#666; font-size:12px; line-height:1.4;">' + (moduleDefinition.hubDescription || '') + '</p>';
    card.addEventListener('click', function() {
      window.switchModule(moduleDefinition.id);
    });
    card.addEventListener('mouseover', function() {
      card.style.borderColor = accent;
      card.style.boxShadow = '0 4px 16px ' + accent + '33';
      card.style.transform = 'translateY(-2px)';
    });
    card.addEventListener('mouseout', function() {
      card.style.borderColor = '#e0e0e0';
      card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
      card.style.transform = 'none';
    });
    return card;
  }

  function renderHubModules() {
    var hubGrid = document.getElementById('hubModulesGrid');
    if (!hubGrid || !registry || typeof registry.getModules !== 'function') {
      return;
    }

    hubGrid.innerHTML = '';
    registry.getModules().forEach(function(moduleDefinition) {
      if (typeof registry.canAccessModule === 'function' && !registry.canAccessModule(moduleDefinition.id, window.currentRole)) {
        return;
      }
      hubGrid.appendChild(createHubCard(moduleDefinition));
    });
  }

  window.renderHubModules = renderHubModules;

  // Loader de datos por tab: función que se llama al ACTIVAR el tab (no en cada
  // onclick). Centraliza la carga aquí para que activar un tab — por clic O por
  // restauración tras F5 — siempre cargue sus datos. Mecanismo global; los tabs
  // sin datos propios simplemente no aparecen aquí.
  var tabLoaders = {
    rec_dashboards: 'loadRecAdminDashboards',
    rec_settings: 'loadRecSettings',
    clientes: 'loadClientesModule',
    catalogo: 'loadCatalogoModule',
    agregar: 'loadAgregarCubicacion'   // 5N-C: tab "Agregar Cubicación"
  };

  window.switchTab = function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(function(tabContent) {
      tabContent.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(function(button) {
      button.classList.remove('active');
    });

    var tab = document.getElementById('tab-' + tabName);
    if (tab) {
      tab.classList.add('active');
    }

    var label = tabLabels[tabName] || tabName;
    document.querySelectorAll('.tab-btn').forEach(function(button) {
      if (button.textContent.indexOf(label) !== -1) {
        button.classList.add('active');
      }
    });

    updateNavHash(window.currentModule, tabName, null);

    // Cargar datos del tab si tiene loader registrado (clic o restauración F5).
    if (tabLoaders[tabName]) {
      callIfDefined(tabLoaders[tabName]);
    }
  };

  function applyModuleVisibility(mod, cfg) {
    document.querySelectorAll('.tab-btn').forEach(function(button) {
      button.style.display = button.classList.contains(cfg.css) ? '' : 'none';
    });

    if (mod === 'cubicacion' && window.currentRole === 'cliente') {
      var hiddenTabs = ['obras', 'buscar', 'pedidos', 'export'];
      document.querySelectorAll('.tab-btn.mod-cubicacion').forEach(function(button) {
        var onclick = button.getAttribute('onclick') || '';
        var match = onclick.match(/switchTab\('(\w+)'\)/);
        if (match && hiddenTabs.indexOf(match[1]) !== -1) {
          button.style.display = 'none';
        }
      });
    }

    if (mod === 'cubicacion') {
      // Crear obra solo admin/admin_calidad (decisión 2026-06-18). El backend
      // valida igual; aquí solo se muestra/oculta el botón.
      var puedeCrearObra = ['admin', 'admin_calidad'].indexOf(window.currentRole) !== -1;
      var btnCrearObra = document.getElementById('btnCrearObra');
      if (btnCrearObra) btnCrearObra.style.display = puedeCrearObra ? '' : 'none';
    }

    if (mod === 'reclamos') {
      var puedeCrear = ['admin', 'admin_calidad', 'usc'].indexOf(window.currentRole) !== -1;
      var crearCard = document.getElementById('crearReclamoCard');
      if (crearCard) {
        crearCard.style.display = puedeCrear ? '' : 'none';
      }
      var asignadoA = document.getElementById('recAsignadoA');
      if (asignadoA && asignadoA.parentElement) {
        asignadoA.parentElement.style.display = (window.currentRole === 'admin' || window.currentRole === 'admin_calidad') ? '' : 'none';
      }
      // Dashboards, Procedimientos y Configuración: solo admin/admin_calidad
      var esAdmin = (window.currentRole === 'admin' || window.currentRole === 'admin_calidad');
      var dashBtn = document.getElementById('recShellBtnDash');
      if (dashBtn) dashBtn.style.display = esAdmin ? '' : 'none';
      var procBtn = document.getElementById('recShellBtnProc');
      if (procBtn) procBtn.style.display = esAdmin ? '' : 'none';
      var setBtn = document.getElementById('recShellBtnSettings');
      if (setBtn) setBtn.style.display = esAdmin ? '' : 'none';
    }

    if (mod === 'admin') {
      var esAdmin = window.currentRole === 'admin';
      ['adminCalculistasCard', 'adminGestionDatosCard', 'adminEstadoBdCard', 'adminResetBdCard'].forEach(function(id) {
        var element = document.getElementById(id);
        if (element) {
          element.style.display = esAdmin ? '' : 'none';
        }
      });
      var roleSelector = document.getElementById('newUserRole');
      if (roleSelector && !esAdmin) {
        roleSelector.innerHTML = '<option value="usc">USC</option>';
      }
    }
  }

  async function loadModuleData(mod) {
    if (modulesLoaded[mod]) {
      return;
    }
    modulesLoaded[mod] = true;

    var definition = registry && typeof registry.getModule === 'function' ? registry.getModule(mod) : null;
    if (!definition || !definition.loaderFunction) {
      return;
    }

    await Promise.resolve(callIfDefined(definition.loaderFunction));
  }

  window.loadModuleData = loadModuleData;

  // switchModule(mod[, tabDestino])
  // tabDestino opcional: si se pasa (p.ej. al restaurar la posición tras F5),
  // se abre directo ese tab en vez del defaultTab — sin pasar primero por el
  // default y "saltar" después. Mecanismo GLOBAL: sirve a cualquier módulo/tab,
  // no hay lógica especial por panel.
  window.switchModule = async function switchModule(mod, tabDestino) {
    // 5M.9: si salgo del Bar Manager (cubicación) con cambios de edición sin
    // guardar, confirmar el descarte antes de navegar a otra sección.
    if (window.currentModule === 'cubicacion' && mod !== 'cubicacion' &&
        typeof window.bmHayCambiosSinGuardar === 'function' && window.bmHayCambiosSinGuardar()) {
      if (!confirm('Tienes cambios sin guardar en las barras.\n\nSi cambias de sección se descartarán. ¿Salir de todas formas?')) {
        return;
      }
      if (typeof window.bmResetModoEdicion === 'function') window.bmResetModoEdicion();
    }

    // Salir del Bar Manager con filtros de ubicación/foco activos: avisar que se
    // perderán (los filtros no sobreviven a la salida de la pantalla; solo a un F5).
    if (window.currentModule === 'cubicacion' && mod !== 'cubicacion' &&
        typeof window.bmHayFiltrosActivos === 'function' && window.bmHayFiltrosActivos()) {
      if (!confirm('Al salir se perderán los filtros aplicados en el Bar Manager.\n\n¿Salir de todas formas?')) {
        return;
      }
    }
    // Al salir del Bar Manager, limpiar la memoria de filtros (sessionStorage).
    if (window.currentModule === 'cubicacion' && mod !== 'cubicacion' &&
        typeof window.clearFiltersStorage === 'function') {
      window.clearFiltersStorage();
    }

    var hub = document.getElementById('hubScreen');
    var container = document.getElementById('moduleContainer');
    var title = document.getElementById('moduleTitle');

    if (mod === 'hub') {
      if (container) {
        container.style.display = 'none';
      }
      if (hub) {
        hub.style.display = 'block';
      }
      window.currentModule = 'hub';
      updateNavHash('hub', null, null);
      renderHubModules();
      callIfDefined('loadLandingIndicadores');
      callIfDefined('loadNotifCount');
      return;
    }

    var cfg = registry && typeof registry.getModule === 'function' ? registry.getModule(mod) : null;
    if (!cfg) {
      return;
    }
    if (registry && typeof registry.canAccessModule === 'function' && !registry.canAccessModule(mod, window.currentRole)) {
      return;
    }

    if (hub) {
      hub.style.display = 'none';
    }
    if (container) {
      container.style.display = 'block';
    }
    if (title) {
      title.textContent = cfg.title;
    }
    window.currentModule = mod;

    applyModuleVisibility(mod, cfg);
    // Tab destino: el pedido (restauración) si es válido, si no el default.
    window.switchTab(tabDestino || cfg.defaultTab);
    await loadModuleData(mod);
  };
})();