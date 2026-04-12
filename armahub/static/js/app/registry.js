(function initArmaHubRegistry() {
  if (window.ArmaHubRegistry) {
    return;
  }

  var modules = {};
  var requiredKeys = ['id', 'title', 'css', 'defaultTab', 'allowedRoles', 'hubCardId'];

  function cloneModule(definition) {
    return {
      id: definition.id,
      title: definition.title,
      css: definition.css,
      defaultTab: definition.defaultTab,
      allowedRoles: definition.allowedRoles.slice(),
      loaderFunction: definition.loaderFunction || '',
      hubCardId: definition.hubCardId,
      hubOrder: definition.hubOrder || 0,
      hubDescription: definition.hubDescription || '',
      hubAccent: definition.hubAccent || '',
      hubIcon: definition.hubIcon || '🧩'
    };
  }

  function validateModule(definition) {
    requiredKeys.forEach(function(key) {
      if (!definition[key]) {
        throw new Error('[ArmaHubRegistry] Falta la propiedad obligatoria "' + key + '" en el modulo');
      }
    });
    if (!Array.isArray(definition.allowedRoles) || definition.allowedRoles.length === 0) {
      throw new Error('[ArmaHubRegistry] allowedRoles debe ser un arreglo no vacio');
    }
  }

  function registerModule(definition) {
    validateModule(definition);
    modules[definition.id] = cloneModule(definition);
    return modules[definition.id];
  }

  function getModule(id) {
    return modules[id] ? cloneModule(modules[id]) : null;
  }

  function getModules() {
    return Object.keys(modules).map(function(id) {
      return cloneModule(modules[id]);
    }).sort(function(left, right) {
      return left.hubOrder - right.hubOrder;
    });
  }

  function canAccessModule(id, role) {
    var definition = modules[id];
    if (!definition) {
      return false;
    }
    return definition.allowedRoles.indexOf(role) !== -1;
  }

  window.ArmaHubRegistry = {
    registerModule: registerModule,
    getModule: getModule,
    getModules: getModules,
    canAccessModule: canAccessModule,
    requiredKeys: requiredKeys.slice()
  };

  registerModule({
    id: 'cubicacion',
    title: 'Cubicacion',
    css: 'mod-cubicacion',
    defaultTab: 'inicio',
    allowedRoles: ['admin', 'cubicador', 'cliente'],
    loaderFunction: 'loadCubicacionModule',
    hubCardId: 'hubCardCubicacion',
    hubOrder: 10,
    hubDescription: 'Metricas, obras, barras, dashboards, pedidos y exportacion.',
    hubAccent: '#4285f4',
    hubIcon: '🏗️'
  });

  registerModule({
    id: 'reclamos',
    title: 'Reclamos',
    css: 'mod-reclamos',
    defaultTab: 'reclamos',
    allowedRoles: ['admin', 'admin2', 'cubicador', 'usc', 'externo'],
    loaderFunction: 'loadReclamosModule',
    hubCardId: 'hubCardReclamos',
    hubOrder: 20,
    hubDescription: 'Registro, analisis, validacion y presentaciones de reclamos.',
    hubAccent: '#f59e0b',
    hubIcon: '📋'
  });

  registerModule({
    id: 'admin',
    title: 'Administracion',
    css: 'mod-admin',
    defaultTab: 'admin',
    allowedRoles: ['admin', 'admin2'],
    loaderFunction: 'loadAdminModule',
    hubCardId: 'hubCardAdmin',
    hubOrder: 30,
    hubDescription: 'Usuarios, proyectos, datos y auditoria.',
    hubAccent: '#8b5cf6',
    hubIcon: '⚙️'
  });
})();