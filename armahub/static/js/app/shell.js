(function initArmaHubShell() {
  if (window.__armahubShellLoaded) {
    return;
  }
  window.__armahubShellLoaded = true;

  var modulesLoaded = {};
  var registry = window.ArmaHubRegistry;
  var tabLabels = {
    inicio: 'Inicio',
    obras: 'Obras',
    buscar: 'Bar Manager',
    dashboards: 'Dashboards',
    pedidos: 'Pedidos',
    export: 'Exportacion',
    reclamos: 'Reclamos',
    admin: 'Admin'
  };

  window.currentModule = 'hub';

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

    if (mod === 'reclamos') {
      var puedeCrear = ['admin', 'admin2', 'usc'].indexOf(window.currentRole) !== -1;
      var crearCard = document.getElementById('crearReclamoCard');
      if (crearCard) {
        crearCard.style.display = puedeCrear ? '' : 'none';
      }
      var asignadoA = document.getElementById('recAsignadoA');
      if (asignadoA && asignadoA.parentElement) {
        asignadoA.parentElement.style.display = (window.currentRole === 'admin' || window.currentRole === 'admin2') ? '' : 'none';
      }
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

  window.switchModule = async function switchModule(mod) {
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
    window.switchTab(cfg.defaultTab);
    await loadModuleData(mod);
  };
})();